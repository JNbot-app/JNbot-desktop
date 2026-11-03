import fs from './storage/portableFs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { promisify } from 'util';
import { devicePath, portablePath } from './storage/portablePaths';
import { getPlatform } from '../platform';
import axios from 'axios';
import {
  ProfileScript,
  ProfileScriptBundle,
  validatePluginPayload,
} from '../../../common/profileScripts';
import type { MacroCode, MacroInfo } from '../types';
import Macros_ from './Macros';
import {
  checksumOfCode,
  deobfuscateCode,
  obfuscateCode,
  obfuscateCodeToBase64,
  deobfuscateCodeFromBase64,
  inflatePluginPayload,
} from './scriptObfuscate';
import {
  PluginSignatureV2,
  exportablePluginInfo,
  pluginSecurity,
} from './signing';
import { handle } from './ipcHandle';
import { portableScriptPath, resolveScriptPath } from './profileScriptPaths';

const readFile = promisify(fs.readFile);

type PluginPayload = {
  info: MacroInfo;
  code: MacroCode;
  signature?: PluginSignatureV2;
};
type FetchResult = PluginPayload | { error: string };

/** Reused TCP/TLS connections across fetches to the same CDN host. */
const keepAliveAgent = new https.Agent({ keepAlive: true });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ordered list of independent hosts to try for a download. Plugins are served
 * through the Cloudflare Pages `/plugin` proxy (immutable, edge-cached, backed
 * by raw.githubusercontent). We try the proxy first, then fall back to its raw
 * origin directly, so a Cloudflare Pages outage doesn't make plugins
 * unavailable. (jsDelivr is no longer used.) A non-proxy URL is returned as-is
 * (single host).
 *
 * Proxy URL shape:  https://<host>/plugin/<branch>/<server>/<hash>.jnp
 * Raw origin:       https://raw.githubusercontent.com/<repo>/refs/heads/<branch>/plugins/<server>/<hash>.jnp
 */
function fetchHosts(url: string): string[] {
  const m = url.match(/^https:\/\/[\w.-]+\/plugin\/((?:main|jndata-[\d.]+)\/.+)$/i);
  if (!m) return [url];
  const rest = m[1]; // <branch>/<server>/<hash>.jnp
  const slash = rest.indexOf('/');
  const branch = rest.slice(0, slash);
  const sub = rest.slice(slash + 1); // <server>/<hash>.jnp
  return [
    url, // Cloudflare Pages proxy (preferred)
    `https://raw.githubusercontent.com/usserwout/JNbot-updater/refs/heads/${branch}/plugins/${sub}`,
  ];
}

/**
 * Download the raw body of `url`, falling back across mirror hosts and making
 * a second pass (after a short backoff) if every host fails the first time.
 * Returns the body text, or throws the last error when all attempts fail.
 */
async function fetchRawWithFallback(url: string): Promise<string> {
  const hosts = fetchHosts(url);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const host of hosts) {
      try {
        const res = await axios.get(host, {
          // Some hosts (raw gists, etc.) send text/plain — parse ourselves.
          transformResponse: [(d) => d],
          timeout: 8000,
          maxContentLength: 5 * 1024 * 1024,
          httpsAgent: keepAliveAgent,
        });
        return res.data as string;
      } catch (err) {
        lastErr = err;
      }
    }
    if (attempt === 0) await delay(400);
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Failed to download from URL');
}

/**
 * Resolved view of a profile script — what dashboard / worker actually
 * need to render and run a script. Always cheap to recompute, so we do
 * not cache (per the explicit "no caching for now" requirement).
 */
export interface ResolvedProfileScript {
  script: ProfileScript;
  info: MacroInfo;
  /**
   * The executable payload. Always present for a run-time resolve
   * (`resolve(script, true)`). `null` for a display-only resolve of a
   * `url` script, where we deliberately skip the download and serve the
   * cached info only.
   */
  code: MacroCode | null;
  /** True when checksum matched (or wasn't required). */
  checksumOk: boolean;
  /** True when the Ed25519 signature verifies against the payload. */
  signatureOk: boolean;
  /** Convenience for UI ("verified" badge). */
  verified: boolean;
}

class ProfileScripts_ {
  macros: Macros_;

  /**
   * In-memory cache of `url` scripts' MacroInfo, keyed by URL. Lets a
   * display resolve return instantly (no disk, no network) while a fresh
   * copy is fetched in the background — info only; code is never cached.
   */
  private urlInfoMem = new Map<string, MacroInfo>();
  /** Last background-refresh time per URL — throttles refresh bursts. */
  private urlInfoRefreshAt = new Map<string, number>();
  private static readonly URL_INFO_REFRESH_TTL = 60_000;
  /** In-flight downloads keyed by URL, so concurrent callers share one fetch. */
  private inflight = new Map<string, Promise<FetchResult>>();

  constructor(macros: Macros_) {
    this.macros = macros;
    this.events();
  }

  /**
   * IPC: the renderer wizard / dashboard pass a `ProfileScript` and get
   * back the resolved info + verification flags for *display*. This is the
   * cheap path — `plugin`/`bundled` read local disk and `url` returns the
   * cached info without any download. Running a script goes through
   * `resolve(script, true)` directly (see ScriptHandler / runners), which
   * downloads `url` code fresh so updates propagate.
   */
  private events() {
    handle('profile-script-resolve', async (_e, script: ProfileScript) => {
      try {
        const resolved = await this.resolve(script);
        return resolved ?? { error: 'Failed to resolve' };
      } catch (err: any) {
        return { error: err?.message ?? 'Failed' };
      }
    });

    // Display-only resolve for the dashboard cards: we only need `info`, so
    // skip reading/deobfuscating the (unused) code payload entirely.
    handle('profile-script-resolve-info', async (_e, script: ProfileScript) =>
      this.resolveInfo(script),
    );

    handle(
      'profile-script-checksum',
      async (_e, script: ProfileScript) => {
        const loaded = await this.load(script, true);
        if (!loaded?.code) return { error: 'Failed to load' };
        return { checksum: checksumOfCode(loaded.code) };
      },
    );

    // Persist updated info (typically `info.settings`) for a profile script.
    // For `kind: 'plugin'` we route to the existing macros library. For
    // `kind: 'bundled'` we overwrite the per-profile info file in place.
    handle(
      'profile-script-save-info',
      async (_e, payload: { script: ProfileScript; info: MacroInfo }) => {
        try {
          const { script, info } = payload ?? {};
          if (!script || !info?.pluginId) {
            return { ok: false, error: 'Missing script or info' };
          }
          if (script.source.kind === 'plugin') {
            this.macros.saveInfo(info);
            return { ok: true };
          }
          // `bundled` and `url` both cache info to a local file in place.
          if (script.source.kind === 'bundled') {
            fs.writeFileSync(resolveScriptPath(script.source.infoPath), JSON.stringify(info));
            return { ok: true };
          }
          // `url` info is cached per-machine, keyed by the URL (not the
          // possibly-foreign `infoPath` shipped in a predefined profile).
          if (script.source.kind === 'url') {
            this.writeUrlInfoCache(script.source.url, info);
            return { ok: true };
          }
          return { ok: false, error: 'Unsupported source' };
        } catch (err: any) {
          return { ok: false, error: err?.message ?? 'Failed' };
        }
      },
    );

    // Install a profile-attached plugin into the user's regular plugin library. We resolve the
    // ProfileScript to info+code and route through the same import path
    // used by manual file imports — so existing collision handling and
    // signature checks apply.
    handle(
      'profile-plugin-install',
      async (_e, script: ProfileScript) => {
        try {
          // Installing copies the code into the library, so we need the real
          // payload — force a fresh download for `url` scripts.
          const loaded = await this.load(script, true);
          if (!loaded?.code) return { ok: false, error: 'Failed to resolve plugin' };
          // Clear any inherited trust so the import path re-evaluates it.
          const info: MacroInfo = { ...loaded.info };
          delete (info as Partial<MacroInfo>).trust;
          // A `url` download carries its own signature; the script may not.
          const signature =
            script.signature ?? ('signature' in loaded ? loaded.signature : undefined);
          const res = await this.macros._importPlugin(
            info,
            loaded.code,
            'auto',
            signature,
          );
          if (res?.status === 'success') return { ok: true, pluginId: info.pluginId };
          return { ok: false, error: res?.message ?? 'Install failed' };
        } catch (err: any) {
          return { ok: false, error: err?.message ?? 'Failed' };
        }
      },
    );

    // Wizard "From file" picker — accepts a `.jnp` file (the same format
    // used by Macros export), validates it, and caches its info + obfuscated
    // code next to the profile so it keeps working if the original moves.
    handle('profile-script-pick-file', async () => {
      try {
        const result = await getPlatform().openFile({
          title: 'Select JNbot Script',
          filters: [{ name: 'JNbot script', extensions: ['jnp', 'json'] }],
        });
        if (result.canceled || !result.files.length) return { ok: false, canceled: true };
        const raw = inflatePluginPayload(JSON.parse(result.files[0].content));
        const valid = validatePluginPayload(raw);
        if ('error' in valid) return { ok: false, error: valid.error };
        const { info, code } = valid;

        const stagingRoot = portablePath('profileScripts', '_staging');
        fs.mkdirSync(stagingRoot, { recursive: true });
        const id = info.pluginId;
        const infoPath = path.join(stagingRoot, `${id}.info.json`);
        const codePath = path.join(stagingRoot, `${id}.code.jnc`);
        fs.writeFileSync(infoPath, JSON.stringify(info));
        fs.writeFileSync(codePath, obfuscateCode(code) as any);
        return {
          ok: true,
          pluginId: id,
          infoPath: portableScriptPath(infoPath),
          codePath: portableScriptPath(codePath),
          checksum: checksumOfCode(code),
        };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? 'Failed' };
      }
    });

    // Wizard "From URL" validator. We download once *only to verify* the URL
    // points at a real plugin and to seed the info cache for display. The
    // code is intentionally NOT cached — it is re-fetched on every run so
    // the author can push updates everyone picks up. Returns the origin URL
    // + the cached-info path for the `url`-kind source.
    handle('profile-script-fetch-url', async (_e, url: string) => {
      const trimmed = typeof url === 'string' ? url.trim() : '';
      const payload = await this.fetchUrlPlugin(trimmed);
      if ('error' in payload) return { ok: false, error: payload.error };
      try {
        this.writeUrlInfoCache(trimmed, payload.info);
        return {
          ok: true,
          pluginId: payload.info.pluginId,
          url: trimmed,
          infoPath: '',
        };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? 'Failed' };
      }
    });
  }

  /** Cache directory for `url` scripts (info + checksum-pinned code). */
  private urlCacheRoot(): string {
    const root = devicePath('profileScripts', '_urlcache');
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  /** Local path where a `url` script's info is cached, keyed by the URL. */
  private urlInfoCachePath(url: string): string {
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
    return path.join(this.urlCacheRoot(), `${hash}.info.json`);
  }

  /** Local path where a `url` script's code is cached, keyed by its checksum. */
  private urlCodeCachePath(checksum: string): string {
    return path.join(this.urlCacheRoot(), `${checksum}.code.json`);
  }

  /**
   * Cached code payload for a checksum (the content is pinned by the checksum,
   * so a hit is always current), or null. Re-verified against the checksum on
   * read to guard against a corrupted cache file.
   */
  private readUrlCodeCache(checksum: string): PluginPayload | null {
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.urlCodeCachePath(checksum), 'utf8'),
      );
      const valid = validatePluginPayload(raw);
      if ('error' in valid) return null;
      if (checksumOfCode(valid.code) !== checksum) return null;
      return valid;
    } catch {
      return null;
    }
  }

  /** Persist a `url` script's code payload, keyed by checksum (best-effort). */
  private writeUrlCodeCache(checksum: string, payload: PluginPayload): void {
    try {
      fs.writeFileSync(this.urlCodeCachePath(checksum), JSON.stringify(payload));
    } catch {
      /* disk cache is best-effort */
    }
  }

  /** Cached info for a `url` script (memory first, then disk), or null. */
  private readUrlInfoCache(url: string): MacroInfo | null {
    const mem = this.urlInfoMem.get(url);
    if (mem) return mem;
    try {
      const info = JSON.parse(
        fs.readFileSync(this.urlInfoCachePath(url), 'utf8'),
      ) as MacroInfo;
      this.urlInfoMem.set(url, info);
      return info;
    } catch {
      return null;
    }
  }

  /** Persist a `url` script's info to both memory and disk (best-effort). */
  private writeUrlInfoCache(url: string, info: MacroInfo): void {
    this.urlInfoMem.set(url, info);
    try {
      fs.writeFileSync(this.urlInfoCachePath(url), JSON.stringify(info));
    } catch {
      /* disk cache is best-effort */
    }
  }

  /** Fire-and-forget background refresh of a `url` script's cached info. */
  private refreshUrlInfo(url: string): void {
    const now = Date.now();
    const last = this.urlInfoRefreshAt.get(url) ?? 0;
    if (now - last < ProfileScripts_.URL_INFO_REFRESH_TTL) return;
    this.urlInfoRefreshAt.set(url, now);
    this.fetchUrlPlugin(url)
      .then((payload) => {
        if (!('error' in payload)) this.writeUrlInfoCache(url, payload.info);
      })
      .catch(() => {
        /* refresh is best-effort */
      });
  }

  /**
   * Download + validate a plugin payload from a URL. Shared by the add-time
   * validator and the run-time loader so both enforce identical rules.
   */
  private async fetchUrlPlugin(url: string): Promise<FetchResult> {
    if (!/^https?:\/\//i.test(url)) return { error: 'Enter a valid http(s) URL' };
    // Collapse concurrent requests for the same URL onto a single download.
    const existing = this.inflight.get(url);
    if (existing) return existing;
    const p = this.downloadAndValidate(url).finally(() =>
      this.inflight.delete(url),
    );
    this.inflight.set(url, p);
    return p;
  }

  private async downloadAndValidate(url: string): Promise<FetchResult> {
    let text: string;
    try {
      text = await fetchRawWithFallback(url);
    } catch (err: any) {
      return { error: err?.message ?? 'Failed to download from URL' };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { error: 'The URL did not return valid JSON' };
    }
    const payload = inflatePluginPayload(raw);
    const valid = validatePluginPayload(payload);
    if ('error' in valid) return valid;
    const signature =
      payload &&
      typeof payload === 'object' &&
      'signature' in payload
        ? (payload as { signature?: PluginSignatureV2 }).signature
        : undefined;
    return { ...valid, signature };
  }

  /**
   * Returns the resolved info (+ verification flags) for a script. Pass
   * `forRun = true` when the code is actually going to be executed: this
   * forces a `url` script to re-download fresh code. For display
   * (`forRun = false`, the default) a `url` script serves cached info only
   * and `code` comes back `null` — see `ResolvedProfileScript.code`.
   *
   * We never throw on a missing file/url; the promise resolves to `null`.
   */
  async resolve(
    script: ProfileScript,
    forRun = false,
  ): Promise<ResolvedProfileScript | null> {
    const loaded = await this.load(script, forRun);
    if (!loaded) return null;
    const { info, code } = loaded;

    const checksumOk =
      script.checksum && code ? checksumOfCode(code) === script.checksum : true;
    const signature = loaded.signature ?? script.signature;
    const verification = signature
      ? pluginSecurity().verify({
          format: 'jnbot-plugin',
          version: 2,
          info,
          code,
          signature,
        })
      : null;
    const signatureOk = !!verification && (
      verification.status === 'trusted' ||
      verification.status === 'valid-untrusted'
    );

    return {
      script,
      info,
      code,
      checksumOk,
      signatureOk,
      verified: checksumOk && signatureOk,
    };
  }

  /**
   * Build the export-time bundle for a script, preserving a valid signature
   * or signing the resolved content with the local publisher identity.
   * The embedded code is obfuscated (base64) so the exported profile file
   * does not leak source. `url` scripts are downloaded fresh so the export is
   * a self-contained snapshot.
   *
   * Signing here is what makes a verified publisher's export trusted on
   * import even for a `plugin`-kind reference whose `ProfileScript` never
   * carried a signature (e.g. a local plugin added from the marketplace).
   * Returns null when the script can't be resolved.
   */
  async bundleForExport(script: ProfileScript): Promise<{
    bundle: ProfileScriptBundle;
    checksum: string;
    signature: PluginSignatureV2;
  } | null> {
    const loaded = await this.load(script, true);
    if (!loaded?.code) return null;
    const currentSignature = loaded.signature ?? script.signature;
    const existing = currentSignature
      ? pluginSecurity().verify({
          format: 'jnbot-plugin',
          version: 2,
          info: loaded.info,
          code: loaded.code,
          signature: currentSignature,
        })
      : null;
    const signature = existing?.signature && (
      existing.status === 'trusted' || existing.status === 'valid-untrusted'
    )
      ? existing.signature
      : pluginSecurity().bundleForExport(loaded.info, loaded.code).signature;
    return {
      bundle: {
        scriptId: script.id,
        info: exportablePluginInfo(loaded.info),
        codeObf: obfuscateCodeToBase64(loaded.code),
      },
      checksum: checksumOfCode(loaded.code),
      signature,
    };
  }

  async resolveInfo(
    script: ProfileScript,
  ): Promise<{ info?: MacroInfo; error?: string }> {
    try {
      const res = await this.loadInfo(script);
      if (!('error' in res)) return { info: res.info };
      if (script.source?.kind === 'url') {
        console.error(
          '[ProfileScripts] resolve-info failed',
          script.source.url,
          res.error,
        );
      }
      return { error: res.error };
    } catch (err: any) {
      console.error('[ProfileScripts] resolve-info threw', err);
      return { error: err?.message ?? 'Failed' };
    }
  }

  /**
   * Info-only resolve for the dashboard display path. Unlike `load`, which
   * collapses every failure to `null`, this preserves the failure *reason* so
   * the caller can show why a script is unavailable. It performs at most one
   * network request (only a cold-cache `url` script hits the network), so the
   * dashboard never pays for a redundant second download just to learn the
   * error — see `profile-script-resolve-info`.
   */
  private async loadInfo(
    script: ProfileScript,
  ): Promise<{ info: MacroInfo } | { error: string }> {
    const src = script.source;
    if (!src) return { error: 'Failed to resolve' };

    if (src.kind === 'plugin') {
      const info = this.macros.readPluginInfo(src.pluginId);
      return info ? { info } : { error: 'Plugin not found in library' };
    }

    if (src.kind === 'bundled') {
      try {
        const info = JSON.parse(
          await readFile(resolveScriptPath(src.infoPath), 'utf8'),
        ) as MacroInfo;
        return { info };
      } catch (err: any) {
        console.error('[ProfileScripts] bundled info load failed', err);
        return { error: err?.message ?? 'Failed to read bundled script' };
      }
    }

    if (src.kind === 'url') {
      // Serve cached info instantly and refresh in the background; only a cold
      // cache blocks on the network — and that single fetch's error is the one
      // we return, with no second request.
      const cached = this.readUrlInfoCache(src.url);
      if (cached) {
        this.refreshUrlInfo(src.url);
        return { info: cached };
      }
      const payload = await this.fetchUrlPlugin(src.url);
      if ('error' in payload) return { error: payload.error };
      this.writeUrlInfoCache(src.url, payload.info);
      return { info: payload.info };
    }

    return { error: 'Unsupported source' };
  }

  private async load(
    script: ProfileScript,
    forRun = false,
  ): Promise<PluginPayload | { info: MacroInfo; code: null } | null> {
    const src = script.source;
    if (!src) return null;

    if (src.kind === 'plugin') {
      const info = this.macros.readPluginInfo(src.pluginId);
      if (!info) return null;
      const code = this.macros.readPlugin(src.pluginId);
      if (!code) return null;
      return { info, code };
    }

    if (src.kind === 'bundled') {
      try {
        const info = JSON.parse(
          await readFile(resolveScriptPath(src.infoPath), 'utf8'),
        ) as MacroInfo;
        const codeRaw = await readFile(resolveScriptPath(src.codePath));
        const code = deobfuscateCode(codeRaw) as MacroCode;
        return { info, code };
      } catch (err) {
        console.error('[ProfileScripts] bundled load failed', err);
        return null;
      }
    }

    if (src.kind === 'url') {
      // Run: serve checksum-pinned code from disk when we have it (the
      // checksum guarantees the bytes are current), otherwise download fresh.
      // A `url` script with no checksum can change at any time with no way to
      // detect it, so it always re-downloads.
      if (forRun) {
        if (script.checksum) {
          const cached = this.readUrlCodeCache(script.checksum);
          if (cached) {
            this.writeUrlInfoCache(src.url, cached.info);
            return cached;
          }
        }
        const payload = await this.fetchUrlPlugin(src.url);
        if ('error' in payload) {
          console.error('[ProfileScripts] url load failed', payload.error);
          return null;
        }
        this.writeUrlInfoCache(src.url, payload.info);
        if (script.checksum && checksumOfCode(payload.code) === script.checksum) {
          this.writeUrlCodeCache(script.checksum, payload);
        }
        return payload;
      }
      // Display: return cached info instantly when we have it, and kick off
      // a background refresh so it's current next time. Only the very first
      // resolve of a URL (cold cache) blocks on the network.
      const cached = this.readUrlInfoCache(src.url);
      if (cached) {
        this.refreshUrlInfo(src.url);
        return { info: cached, code: null };
      }
      const payload = await this.fetchUrlPlugin(src.url);
      if ('error' in payload) return null;
      this.writeUrlInfoCache(src.url, payload.info);
      return { info: payload.info, code: null };
    }

    return null;
  }
}

export { deobfuscateCodeFromBase64 };
export default ProfileScripts_;
