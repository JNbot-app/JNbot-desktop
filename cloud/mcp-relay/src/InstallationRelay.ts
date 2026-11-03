import { DurableObject } from 'cloudflare:workers';
import {
  secureJson,
  sha256,
  validInstallationId,
  verifyEd25519,
} from './security';
import type { DesktopAttachment, DesktopFrame, RelayFrame } from './types';

type PendingResponse = {
  resolve(response: Response): void;
  timeout: ReturnType<typeof setTimeout>;
};

type PairingRow = {
  id: string;
  code: string;
  client_name: string;
  request_hash: string;
  requested_scopes: string;
  approved_scopes: string | null;
  local_client_id: string | null;
  status: string;
  expires_at: number;
};

const MAX_BODY_BYTES = 1024 * 1024;
const FORWARD_TIMEOUT_MS = 20_000;
const CLOCK_SKEW_MS = 60_000;

export class InstallationRelay extends DurableObject<Env> {
  private readonly pending = new Map<string, PendingResponse>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS installation (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        public_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS nonces (
        nonce_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pairings (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        client_name TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        requested_scopes TEXT NOT NULL,
        approved_scopes TEXT,
        local_client_id TEXT,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS grants (
        client_hash TEXT PRIMARY KEY,
        local_client_hash TEXT NOT NULL,
        scopes TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS rate_buckets (
        bucket INTEGER PRIMARY KEY,
        count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        event TEXT NOT NULL,
        decision TEXT NOT NULL
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/desktop/register' && request.method === 'POST')
      return this.register(request);
    if (url.pathname === '/desktop/socket') return this.connectDesktop(request);
    if (url.pathname === '/pair/start' && request.method === 'POST')
      return this.startPairing(request);
    if (url.pathname === '/pair/status') return this.pairingStatus(url);
    if (url.pathname === '/mcp') return this.forwardMcp(request);
    if (url.pathname === '/revoke' && request.method === 'POST')
      return this.revoke(request);
    return secureJson({ error: 'not_found' }, 404);
  }

  async webSocketMessage(
    webSocket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment =
      webSocket.deserializeAttachment() as DesktopAttachment | null;
    if (attachment?.role !== 'desktop')
      return webSocket.close(1008, 'Invalid attachment');
    if (typeof message !== 'string' || message.length > MAX_BODY_BYTES + 16_384)
      return webSocket.close(1009, 'Frame too large');
    let frame: DesktopFrame;
    try {
      frame = JSON.parse(message) as DesktopFrame;
    } catch {
      return webSocket.close(1007, 'Invalid JSON');
    }
    if (frame.type === 'response') {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      clearTimeout(pending.timeout);
      pending.resolve(
        new Response(frame.body, {
          status: Math.min(599, Math.max(200, frame.status)),
          headers: this.safeResponseHeaders(frame.headers),
        }),
      );
      return;
    }
    if (frame.type === 'pairing_decision')
      await this.recordPairingDecision(frame);
    if (frame.type === 'sync_pairings') this.sendPendingPairings(webSocket);
  }

  webSocketClose(webSocket: WebSocket, code: number, reason: string): void {
    webSocket.close(code, reason);
  }

  webSocketError(webSocket: WebSocket): void {
    webSocket.close(1011, 'Desktop relay error');
  }

  private async register(request: Request): Promise<Response> {
    const body = await this.boundedJson<{
      installationId: string;
      publicKey: string;
      timestamp: number;
      nonce: string;
      signature: string;
    }>(request, 16_384);
    if (!validInstallationId(body.installationId))
      return secureJson({ error: 'invalid_installation' }, 400);
    const message = [
      body.installationId,
      body.timestamp,
      body.nonce,
      body.publicKey,
    ].join('\n');
    if (
      !(await this.validFreshSignature(
        body.publicKey,
        body.signature,
        message,
        body.timestamp,
        body.nonce,
      ))
    )
      return secureJson({ error: 'invalid_signature' }, 401);
    const existing = this.publicKey();
    if (existing && existing !== body.publicKey)
      return secureJson({ error: 'identity_already_registered' }, 409);
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO installation (id, public_key, created_at) VALUES (1, ?, ?)',
      body.publicKey,
      Date.now(),
    );
    this.audit('identity.register', 'allowed');
    return secureJson({ registered: true });
  }

  private async connectDesktop(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return secureJson({ error: 'websocket_required' }, 426);
    const publicKey = this.publicKey();
    if (!publicKey)
      return secureJson({ error: 'identity_not_registered' }, 401);
    const installationId = request.headers.get('x-jnbot-installation') ?? '';
    const timestamp = Number(request.headers.get('x-jnbot-timestamp'));
    const nonce = request.headers.get('x-jnbot-nonce') ?? '';
    const signature = request.headers.get('x-jnbot-signature') ?? '';
    const message = [installationId, timestamp, nonce].join('\n');
    if (
      !validInstallationId(installationId) ||
      !(await this.validFreshSignature(
        publicKey,
        signature,
        message,
        timestamp,
        nonce,
      ))
    )
      return secureJson({ error: 'invalid_signature' }, 401);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ['desktop']);
    server.serializeAttachment({
      role: 'desktop',
      installationId,
      connectedAt: Date.now(),
    } satisfies DesktopAttachment);
    this.sendPendingPairings(server);
    this.audit('desktop.connect', 'allowed');
    return new Response(null, { status: 101, webSocket: client });
  }

  private async startPairing(request: Request): Promise<Response> {
    const body = await this.boundedJson<{
      clientName: string;
      requestHash: string;
      requestedScopes: string[];
    }>(request, 16_384);
    const pairingId = crypto.randomUUID();
    const code = String(
      crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000,
    ).padStart(6, '0');
    const expiresAt = Date.now() + 5 * 60_000;
    const scopes = [...new Set(body.requestedScopes)].slice(0, 20);
    this.ctx.storage.sql.exec(
      `INSERT INTO pairings
       (id, code, client_name, request_hash, requested_scopes, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      pairingId,
      code,
      body.clientName.slice(0, 100),
      body.requestHash,
      JSON.stringify(scopes),
      expiresAt,
    );
    const frame = this.pairingFrame({
      id: pairingId,
      code,
      client_name: body.clientName.slice(0, 100),
      request_hash: body.requestHash,
      requested_scopes: JSON.stringify(scopes),
      approved_scopes: null,
      local_client_id: null,
      status: 'pending',
      expires_at: expiresAt,
    });
    for (const socket of this.ctx.getWebSockets('desktop'))
      socket.send(JSON.stringify(frame));
    this.audit('oauth.pairing', 'pending');
    return secureJson({
      pairingId,
      code,
      expiresAt,
      desktopOnline: this.ctx.getWebSockets('desktop').length > 0,
    });
  }

  private pairingStatus(url: URL): Response {
    const pairing = this.pairing(url.searchParams.get('pairingId') ?? '');
    if (!pairing) return secureJson({ error: 'pairing_not_found' }, 404);
    if (pairing.expires_at <= Date.now() && pairing.status === 'pending') {
      this.ctx.storage.sql.exec(
        "UPDATE pairings SET status = 'expired' WHERE id = ?",
        pairing.id,
      );
      pairing.status = 'expired';
    }
    return secureJson({
      status: pairing.status,
      approvedScopes: pairing.approved_scopes
        ? JSON.parse(pairing.approved_scopes)
        : undefined,
      localClientId:
        pairing.status === 'approved' ? pairing.local_client_id : undefined,
      requestHash: pairing.request_hash,
      expiresAt: pairing.expires_at,
    });
  }

  private async forwardMcp(request: Request): Promise<Response> {
    if (!(await this.takeRateToken()))
      return secureJson({ error: 'rate_limited' }, 429);
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES)
      return secureJson({ error: 'payload_too_large' }, 413);
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES)
      return secureJson({ error: 'payload_too_large' }, 413);
    const sockets = this.ctx.getWebSockets('desktop');
    if (!sockets.length) return secureJson({ error: 'desktop_offline' }, 503);
    const id = crypto.randomUUID();
    const frame: RelayFrame = {
      type: 'request',
      id,
      installationId: request.headers.get('x-jnbot-installation') ?? '',
      clientId: request.headers.get('x-jnbot-local-client') ?? '',
      scopes: JSON.parse(request.headers.get('x-jnbot-scopes') ?? '[]'),
      nonce: crypto.randomUUID(),
      timestamp: Date.now(),
      method: request.method,
      headers: this.safeRequestHeaders(request.headers),
      body,
    };
    return new Promise<Response>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve(secureJson({ error: 'desktop_timeout' }, 504));
      }, FORWARD_TIMEOUT_MS);
      this.pending.set(id, { resolve, timeout });
      sockets[0].send(JSON.stringify(frame));
    });
  }

  private async revoke(request: Request): Promise<Response> {
    const body = await this.boundedJson<{ localClientId: string }>(
      request,
      4096,
    );
    const localHash = await sha256(body.localClientId);
    this.ctx.storage.sql.exec(
      'UPDATE grants SET revoked_at = ? WHERE local_client_hash = ?',
      Date.now(),
      localHash,
    );
    this.audit('grant.revoke', 'allowed');
    return secureJson({ revoked: true });
  }

  private async recordPairingDecision(
    frame: Extract<DesktopFrame, { type: 'pairing_decision' }>,
  ): Promise<void> {
    const pairing = this.pairing(frame.pairingId);
    if (
      !pairing ||
      pairing.status !== 'pending' ||
      pairing.expires_at <= Date.now()
    )
      return;
    if (!frame.approved || !frame.localClientId) {
      this.ctx.storage.sql.exec(
        "UPDATE pairings SET status = 'denied' WHERE id = ?",
        frame.pairingId,
      );
      this.audit('oauth.pairing', 'denied');
      return;
    }
    const requested = new Set<string>(JSON.parse(pairing.requested_scopes));
    const scopes = [...new Set(frame.scopes ?? [])].filter((scope) =>
      requested.has(scope),
    );
    this.ctx.storage.sql.exec(
      "UPDATE pairings SET status = 'approved', approved_scopes = ?, local_client_id = ? WHERE id = ?",
      JSON.stringify(scopes),
      frame.localClientId,
      frame.pairingId,
    );
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO grants (client_hash, local_client_hash, scopes, expires_at) VALUES (?, ?, ?, ?)',
      pairing.request_hash,
      await sha256(frame.localClientId),
      JSON.stringify(scopes),
      Date.now() + 30 * 24 * 60 * 60_000,
    );
    this.audit('oauth.pairing', 'allowed');
  }

  private publicKey(): string | undefined {
    return this.ctx.storage.sql
      .exec<{ public_key: string; revoked_at: number | null }>(
        'SELECT public_key, revoked_at FROM installation WHERE id = 1',
      )
      .toArray()
      .find((row) => !row.revoked_at)?.public_key;
  }

  private pairing(id: string): PairingRow | undefined {
    return this.ctx.storage.sql
      .exec<PairingRow>('SELECT * FROM pairings WHERE id = ?', id)
      .toArray()[0];
  }

  private sendPendingPairings(webSocket: WebSocket): void {
    const pending = this.ctx.storage.sql
      .exec<PairingRow>(
        "SELECT * FROM pairings WHERE status = 'pending' AND expires_at > ? ORDER BY expires_at ASC LIMIT 20",
        Date.now(),
      )
      .toArray();
    for (const pairing of pending)
      webSocket.send(JSON.stringify(this.pairingFrame(pairing)));
  }

  private pairingFrame(pairing: PairingRow): RelayFrame {
    return {
      type: 'pairing_request',
      pairingId: pairing.id,
      code: pairing.code,
      clientName: pairing.client_name,
      requestedScopes: JSON.parse(pairing.requested_scopes) as string[],
      expiresAt: pairing.expires_at,
    };
  }

  private async validFreshSignature(
    publicKey: string,
    signature: string,
    message: string,
    timestamp: number,
    nonce: string,
  ): Promise<boolean> {
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > CLOCK_SKEW_MS ||
      nonce.length < 16 ||
      nonce.length > 200
    )
      return false;
    this.ctx.storage.sql.exec(
      'DELETE FROM nonces WHERE expires_at < ?',
      Date.now(),
    );
    const nonceHash = await sha256(nonce);
    const replay =
      this.ctx.storage.sql
        .exec('SELECT nonce_hash FROM nonces WHERE nonce_hash = ?', nonceHash)
        .toArray().length > 0;
    if (replay || !(await verifyEd25519(publicKey, signature, message)))
      return false;
    this.ctx.storage.sql.exec(
      'INSERT INTO nonces (nonce_hash, expires_at) VALUES (?, ?)',
      nonceHash,
      Date.now() + CLOCK_SKEW_MS * 2,
    );
    return true;
  }

  private async boundedJson<T>(request: Request, maxBytes: number): Promise<T> {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes)
      throw new Error('payload_too_large');
    return JSON.parse(text) as T;
  }

  private async takeRateToken(): Promise<boolean> {
    const bucket = Math.floor(Date.now() / 60_000);
    this.ctx.storage.sql.exec(
      'DELETE FROM rate_buckets WHERE bucket < ?',
      bucket - 1,
    );
    const current =
      this.ctx.storage.sql
        .exec<{
          count: number;
        }>('SELECT count FROM rate_buckets WHERE bucket = ?', bucket)
        .toArray()[0]?.count ?? 0;
    if (current >= 120) return false;
    this.ctx.storage.sql.exec(
      `INSERT INTO rate_buckets (bucket, count) VALUES (?, 1)
       ON CONFLICT(bucket) DO UPDATE SET count = count + 1`,
      bucket,
    );
    return true;
  }

  private safeRequestHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    for (const name of [
      'accept',
      'content-type',
      'mcp-protocol-version',
      'mcp-session-id',
    ]) {
      const value = headers.get(name);
      if (value) result[name] = value.slice(0, 1_024);
    }
    return result;
  }

  private safeResponseHeaders(headers: Record<string, string>): Headers {
    const result = new Headers({ 'cache-control': 'no-store' });
    for (const name of ['content-type', 'mcp-session-id']) {
      const value = headers[name];
      if (value) result.set(name, value.slice(0, 1_024));
    }
    return result;
  }

  private audit(event: string, decision: string): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO audit (id, timestamp, event, decision) VALUES (?, ?, ?, ?)',
      crypto.randomUUID(),
      Date.now(),
      event,
      decision,
    );
    this.ctx.storage.sql.exec(
      'DELETE FROM audit WHERE timestamp < ?',
      Date.now() - 7 * 24 * 60 * 60_000,
    );
  }
}
