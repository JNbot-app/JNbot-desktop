import crypto from 'crypto';

const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';
const TOKEN = 'https://api.dropboxapi.com/oauth2/token';
const ROOT = '/JNbot';
// Dropbox app keys are public OAuth client identifiers, not secrets.
export const DROPBOX_APP_KEY = process.env.JNBOT_DROPBOX_APP_KEY || 'fm8erb3uv1b1pko';
export const DROPBOX_SCOPES = 'files.metadata.read files.content.read files.content.write account_info.read';

type Http = typeof fetch;

export class DropboxError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export class DropboxHttp {
  private cachedToken?: { refreshToken: string; value: string; expiresAt: number };
  private refreshingToken?: { refreshToken: string; promise: Promise<string> };
  private rateLimitUntil = 0;

  constructor(readonly appKey: string, private readonly http: Http = fetch) {
  }

  private configured(): void {
    if (!this.appKey) throw new DropboxError('Dropbox is not configured for this JNbot build.');
  }

  beginLogin(): { url: string; verifier: string } {
    this.configured();
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: this.appKey,
      response_type: 'code',
      token_access_type: 'offline',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: DROPBOX_SCOPES,
    }).toString();
    return { url: url.toString(), verifier };
  }

  async exchangeCode(code: string, verifier: string): Promise<string> {
    this.configured();
    const data = await this.token({
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      client_id: this.appKey,
    });
    if (typeof data.refresh_token !== 'string') throw new DropboxError('Dropbox did not grant offline access.');
    return data.refresh_token;
  }

  async accessToken(refreshToken: string): Promise<string> {
    this.configured();
    if (this.cachedToken?.refreshToken === refreshToken && this.cachedToken.expiresAt > Date.now() + 60_000)
      return this.cachedToken.value;
    if (this.refreshingToken?.refreshToken === refreshToken) return this.refreshingToken.promise;
    const promise = this.token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.appKey })
      .then((data) => {
        if (typeof data.access_token !== 'string') throw new DropboxError('Dropbox did not return an access token.');
        const lifetime = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 300;
        this.cachedToken = { refreshToken, value: data.access_token, expiresAt: Date.now() + lifetime * 1000 };
        return data.access_token;
      });
    this.refreshingToken = { refreshToken, promise };
    try { return await promise; }
    finally { if (this.refreshingToken?.promise === promise) this.refreshingToken = undefined; }
  }

  private async token(values: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.request(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    });
    return this.json(response);
  }

  async account(token: string): Promise<{ account_id: string; email?: string; name?: { display_name?: string } }> {
    const response = await this.request(`${API}/users/get_current_account`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: 'null',
    });
    return this.json(response);
  }

  async downloadZip(token: string): Promise<Buffer | undefined> {
    const response = await this.request(`${CONTENT}/files/download_zip`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: ROOT }) },
    }, 60_000);
    if (response.status === 409 && (await response.text()).includes('not_found')) return undefined;
    if (!response.ok) throw new DropboxError('Dropbox folder download failed.', response.status);
    return Buffer.from(await response.arrayBuffer());
  }

  async upload(token: string, relativePath: string, bytes: Buffer): Promise<void> {
    const options: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: `${ROOT}/${relativePath}`, mode: 'overwrite', autorename: false, mute: true }),
      },
      body: bytes,
    };
    let response = await this.request(`${CONTENT}/files/upload`, options);
    if (response.status === 409 && (await response.text()).includes('not_found')) {
      await this.ensureParentFolders(token, relativePath);
      response = await this.request(`${CONTENT}/files/upload`, options);
    }
    if (!response.ok) throw new DropboxError(`Dropbox file upload failed. (response status ${response.status})`, response.status);
  }

  private async ensureParentFolders(token: string, relativePath: string): Promise<void> {
    const parts = relativePath.split('/');
    for (let depth = 0; depth < parts.length; depth += 1) {
      const folder = [ROOT, ...parts.slice(0, depth)].join('/');
      const created = await this.rpc(token, 'files/create_folder_v2', { path: folder, autorename: false });
      if (created.status === 409 && (await created.text()).includes('conflict/folder')) continue;
      await this.json(created);
    }
  }

  async delete(token: string, relativePath: string): Promise<void> {
    const response = await this.rpc(token, 'files/delete_v2', { path: `${ROOT}/${relativePath}` });
    if (response.status === 409 && (await response.text()).includes('not_found')) return;
    await this.json(response);
  }

  private rpc(token: string, method: string, body: unknown): Promise<Response> {
    return this.request(`${API}/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request(url: string, options: RequestInit, timeoutMs = 12_000): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      while (this.rateLimitUntil > Date.now())
        await new Promise((resolve) => setTimeout(resolve, this.rateLimitUntil - Date.now()));
      const response = await this.requestOnce(url, options, timeoutMs);
      if (response.status !== 429 || attempt >= 6) return response;
      const header = Number(response.headers.get('Retry-After'));
      const wait = response.headers.has('Retry-After') && Number.isFinite(header) && header >= 0
        ? header * 1000 : Math.min(2 ** attempt * 1000, 30_000);
      this.rateLimitUntil = Math.max(this.rateLimitUntil, Date.now() + wait);
    }
  }

  private async requestOnce(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.http(url, { ...options, signal: controller.signal });
    } catch {
      throw new DropboxError('Dropbox is unavailable. Check the connection and try again.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async json<T = Record<string, unknown>>(response: Response): Promise<T> {
    if (!response.ok) {
      const message = response.status === 401 ? 'Dropbox authorization expired or was revoked.' :
        response.status === 429 ? 'Dropbox is temporarily rate limiting JNbot.' :
          'Dropbox request failed. Check the connection and try again.';
      throw new DropboxError(message, response.status);
    }
    return response.json() as Promise<T>;
  }
}
