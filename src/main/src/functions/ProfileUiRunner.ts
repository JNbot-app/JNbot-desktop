import vm from 'vm';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { ipcMain } from 'electron';
import type { ProfileScript } from '../../../common/profileScripts';
import {
  sanitizeProfileUiJson,
  ProfileUiJson,
} from '../../../common/profileUiSchema';
import { PROFILE_UI_BUILDERS_SOURCE } from '../../../common/profileUiBuildersSource';
import type {
  JNdata,
  JNdataDataSection,
  JNdataServer,
  MacroCodeJavascript,
  ServerAltInfo,
  Stats,
} from '../types';
import type Settings_ from './Settings';
import { handle } from './ipcHandle';
import { toRunnableJs } from './transpile';
import type ProfileScripts_ from './ProfileScripts';
import { isPluginDisallowed } from '../../../common/profiles';

const SCRIPT_TIMEOUT_MS = 5_000;
const FETCH_TIMEOUT_MS = 6_000;
const FETCH_MAX_BYTES = 1 << 20; // 1 MiB

export interface ProfileUiRunRequest {
  /** Server id whose profile owns the action. */
  server: string;
  /** Player being looked up (may differ from any alt). */
  username: string;
}

/** A single console call made by a sandboxed action, captured for the UI. */
export interface PreviewLog {
  level: 'log' | 'warn' | 'error' | 'info';
  text: string;
}

export type ProfileUiRunResponse =
  | { ok: true; json: ProfileUiJson; logs: PreviewLog[] }
  | { ok: false; reason: 'no-action' }
  | { ok: false; reason: 'error'; error: string; logs?: PreviewLog[] };

class ProfileUiRunner {
  constructor(
    private settings: Settings_,
    private scripts: ProfileScripts_,
  ) {
    handle(
      'profile-ui-run',
      async (
        _e,
        req: ProfileUiRunRequest,
      ): Promise<ProfileUiRunResponse> => {
        try {
          return await this.run(req);
        } catch (err: any) {
          return { ok: false, reason: 'error', error: err?.message ?? String(err) };
        }
      },
    );

    // Wizard preview: run a script the user is editing against either a
    // real alt (when `username` matches one) or synthetic sample data.
    handle(
      'profile-ui-preview',
      async (
        _e,
        req: { script: ProfileScript; username: string; server: string },
      ): Promise<ProfileUiRunResponse> => {
        try {
          if (!req?.script || !req.username) {
            return { ok: false, reason: 'error', error: 'script and username required' };
          }
          return await this.runScript(req.script, req.server, req.username);
        } catch (err: any) {
          return { ok: false, reason: 'error', error: err?.message ?? String(err) };
        }
      },
    );

    // Editor preview: run the *unsaved* source the user is currently editing
    // in the code editor. Unlike `profile-ui-preview`, nothing is resolved
    // from disk or checksum-verified — we run the raw code as-is.
    handle(
      'profile-ui-preview-code',
      async (
        _e,
        req: { code: string; language: 'js' | 'ts'; server: string; username: string },
      ): Promise<ProfileUiRunResponse> => {
        try {
          if (!req?.username) {
            return { ok: false, reason: 'error', error: 'username required' };
          }
          return await this.runCode(
            req.code ?? '',
            req.language === 'ts' ? 'ts' : 'js',
            req.server,
            req.username,
          );
        } catch (err: any) {
          return { ok: false, reason: 'error', error: err?.message ?? String(err) };
        }
      },
    );
  }

  /**
   * Resolve the action for the requested profile, run it in a sandboxed VM,
   * validate the output, and return it. Predefined profiles (no custom
   * action attached) report `no-action` so the renderer can fall back to
   * its built-in minimal layout.
   */
  private async run(req: ProfileUiRunRequest): Promise<ProfileUiRunResponse> {
    if (!req?.username) {
      return { ok: false, reason: 'error', error: 'username required' };
    }
    const action = this.resolveAction(req.server);
    if (
      !action ||
      isPluginDisallowed(
        this.settings.JNdata?.data?.[req.server],
        action.pluginId,
      )
    )
      return { ok: false, reason: 'no-action' };
    return this.runScript(action, req.server, req.username);
  }

  private async runScript(
    script: ProfileScript,
    server: string,
    username: string,
  ): Promise<ProfileUiRunResponse> {
    const resolved = await this.scripts.resolve(script, true);
    if (!resolved?.code) {
      return { ok: false, reason: 'error', error: 'failed to resolve action' };
    }
    if (resolved.info.language !== 'js' && resolved.info.language !== 'ts') {
      return {
        ok: false,
        reason: 'error',
        error: 'profile-UI action must use JavaScript/TypeScript',
      };
    }

    return this.runCode(
      (resolved.code as MacroCodeJavascript).code ?? '',
      resolved.info.language,
      server,
      username,
    );
  }

  /** Transpile, sandbox-run, and validate raw action source. */
  private async runCode(
    rawCode: string,
    language: 'js' | 'ts',
    server: string,
    username: string,
  ): Promise<ProfileUiRunResponse> {
    const logs: PreviewLog[] = [];
    const args = this.buildArgs(server, username);
    // TS actions are type-stripped to plain JS before running in the sandbox.
    const code = await toRunnableJs(rawCode, language);
    try {
      const raw = await this.evalSandboxed(code, args, logs);
      const json = sanitizeProfileUiJson(raw);
      if (!json) {
        return { ok: false, reason: 'error', error: 'invalid profile UI JSON', logs };
      }
      return { ok: true, json, logs };
    } catch (err: any) {
      return {
        ok: false,
        reason: 'error',
        error: err?.message ?? String(err),
        logs,
      };
    }
  }

  private resolveAction(server: string): ProfileScript | null {
    // Read from the merged JNdata (built-in servers from JNdata + custom
    // profiles both land in `data[server]`), the same source the bot-extension
    // slot uses. Reading the custom-profiles store alone would miss every
    // built-in server, since those never live in profiles.json.

    return this.settings.JNdata?.data?.[server]?.profileUiAction ?? null;
  }

  /** Build the read-only `args` object handed to the sandboxed action. */
  private buildArgs(server: string, username: string) {
    const sharedAlt = (this.settings.shared.alts ?? []).find(
      (a) => a.username.toLowerCase() === username.toLowerCase(),
    );

    const alt = sharedAlt
      ? {
          username: sharedAlt.username,
          UID: sharedAlt.UID ?? null,
          email: sharedAlt.email,
        }
      : null;

    const rawInfo = sharedAlt
      ? this.settings.getProfileSettings(server).altData?.[sharedAlt.username] ??
        null
      : null;
    const serverAltInfo = scrubServerAltInfo(rawInfo);

    const stats = pickAltStats(this.settings.stats?.stats, username);

    const profile = pickServerProfile(this.settings.JNdata, server);

    // Plain data only: it crosses into the sandbox as JSON, so the action
    // never holds a reference to a main-process object.
    return { server, username, alt, serverAltInfo, stats, profile };
  }

  private evalSandboxed(
    source: string,
    args: unknown,
    logs: PreviewLog[],
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: (v: any) => void, v: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(v);
      };
      const timer = setTimeout(() => {
        settle(reject, new Error('profile UI action timed out'));
      }, SCRIPT_TIMEOUT_MS);

      // Every entry into the context goes through here, so the timeout also
      // covers async continuations (microtasks run inside each call).
      const exec = (code: string, filename: string) => {
        try {
          new vm.Script(code, { filename }).runInContext(context, {
            timeout: SCRIPT_TIMEOUT_MS,
            displayErrors: true,
          });
        } catch (err: any) {
          settle(reject, new Error(err?.message ?? String(err)));
        }
      };

      // The only host function the sandbox ever sees. It takes and returns
      // strings and never throws, so no main-process object (or its
      // Function constructor) can leak into the context.
      const host = (op: string, payload: string): string | undefined => {
        try {
          if (settled) return undefined;
          switch (op) {
            case 'args':
              return JSON.stringify(args);
            case 'log': {
              const [level, text] = JSON.parse(payload);
              logs.push({ level, text });
              break;
            }
            case 'result':
              settle(resolve, JSON.parse(payload));
              break;
            case 'error':
              settle(reject, new Error(payload));
              break;
            case 'fetch': {
              const { id, url, options } = JSON.parse(payload);
              const deliver = (error: string | null, result: unknown) =>
                !settled &&
                exec(
                  `__deliver(${JSON.stringify(id)}, ${JSON.stringify(error)}, ${JSON.stringify(JSON.stringify(result ?? null))})`,
                  'profileUiFetch.js',
                );
              secureFetch(String(url), options ?? undefined).then(
                (res) => deliver(null, res),
                (err) => deliver(err?.message ?? String(err), null),
              );
              break;
            }
          }
        } catch {
          /* never let a host error object reach the sandbox */
        }
        return undefined;
      };

      // A null-prototype global keeps `this.constructor` inside the context
      // realm, where string code generation is disabled.
      const sandbox = Object.create(null);
      sandbox.__host = host;
      const context = vm.createContext(sandbox, {
        name: 'profile-ui-action',
        codeGeneration: { strings: false, wasm: false },
        microtaskMode: 'afterEvaluate',
      });

      exec(SANDBOX_PRELUDE, 'profileUiPrelude.js');
      // Install the Builder API once per run, before the user's code.
      exec(PROFILE_UI_BUILDERS_SOURCE, 'profileUiBuilders.js');
      // Wrap user code so it always exposes a callable `main` entrypoint —
      // matches the boilerplate we ship in `defaultMacro`.
      exec(
        `${source}\n;__done(Promise.resolve().then(() => main(__args)));`,
        'profileUiAction.js',
      );
    });
  }
}

/**
 * Runs first inside the context. It captures `__host` in a closure and
 * removes it from the global, then builds `console`, `args` (with `fetch`)
 * and the result plumbing from context-realm objects only.
 */
const SANDBOX_PRELUDE = `(() => {
  'use strict';
  const host = globalThis.__host;
  delete globalThis.__host;
  Object.defineProperty(Error, 'prepareStackTrace', { value: undefined, writable: false, configurable: false });
  const freeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.values(o).forEach(freeze);
      Object.freeze(o);
    }
    return o;
  };
  const format = (v) => {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.stack || v.message;
    try { return JSON.stringify(v); } catch { return String(v); }
  };
  const record = (level) => (...parts) =>
    host('log', JSON.stringify([level, parts.map(format).join(' ')]));
  globalThis.console = freeze({
    log: record('log'), info: record('info'), warn: record('warn'),
    error: record('error'), debug: record('log'),
  });
  const pending = new Map();
  let nextId = 0;
  const fetch = (url, options) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    host('fetch', JSON.stringify({ id, url: String(url), options: options ?? null }));
  });
  Object.defineProperty(globalThis, '__deliver', { value: (id, error, result) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (error === null) request.resolve(freeze(JSON.parse(result)));
    else request.reject(new Error(error));
  } });
  globalThis.__args = freeze({ ...JSON.parse(host('args')), fetch });
  Object.defineProperty(globalThis, '__done', { value: (promise) => promise.then(
    (result) => {
      let json;
      try { json = JSON.stringify(result === undefined ? null : result); }
      catch { return host('error', 'profile UI result is not JSON-serializable'); }
      host('result', json);
    },
    (err) => host('error', String(err && err.message !== undefined ? err.message : err)),
  ) });
})();`;

/** Strip the password before exposing per-server alt data to user code. */
function scrubServerAltInfo(
  info: ServerAltInfo | null,
): Omit<ServerAltInfo, 'password'> | null {
  if (!info) return null;
  const { password: _omit, ...rest } = info;
  return rest;
}

/**
 * Public, read-only view of the active server's JNdata for the profile-UI
 * action: server display metadata + the per-gamemode rank/gkit catalog
 * (prices + colors). The script-plumbing fields (`scripts`,
 * `profileUiAction`, `botExtensionAction`, `disallowedPlugins`) are dropped — they are plugin configuration and are
 * useless to a UI renderer.
 */
function pickServerProfile(jndata: JNdata | undefined, server: string) {
  const data = jndata?.data?.[server];
  const gamemodes = jndata?.servers?.[server];
  if (!data || !gamemodes) return null;
  const {
    scripts: _s,
    profileUiAction: _p,
    botExtensionAction: _b,
    disallowedPlugins: _d,
    ...meta
  } = data as JNdataDataSection;
  return {
    server,
    data: meta,
    gamemodes: gamemodes as JNdataServer,
  };
}

function pickAltStats(stats: Stats | undefined, username: string) {
  const entry = stats?.alts?.[username];
  if (!entry) return null;
  return {
    joinCount: entry.joinCount,
    lastJoined: entry.lastJoined,
    playTime: entry.playTime,
    createdOn: entry.createdOn,
  };
}

/**
 * Restricted fetch: only http/https, response body capped at 1 MiB,
 * 6 s timeout, and auto-parses JSON when the content-type opts in. Used
 * by sandboxed actions in place of `globalThis.fetch` (which the VM
 * context never sees).
 */
function secureFetch(
  rawUrl: string,
  options?: { headers?: Record<string, string>; method?: 'GET' | 'POST'; body?: string },
): Promise<{ status: number; ok: boolean; text: string; json: any | null }> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      reject(new Error('invalid URL'));
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      reject(new Error('only http/https URLs are allowed'));
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: options?.method ?? 'GET',
        headers: { 'user-agent': 'jnbot-profile-ui/1.0', ...(options?.headers ?? {}) },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > FETCH_MAX_BYTES) {
            res.destroy(new Error('response exceeded 1 MiB cap'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          // @ts-ignore
          const text = Buffer.concat(chunks).toString('utf8');
          const ct = String(res.headers['content-type'] ?? '');
          let json: any = null;
          if (ct.includes('application/json')) {
            try {
              json = JSON.parse(text);
            } catch {
              /* fall through with json=null */
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            ok: !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
            text,
            json,
          });
        });
        res.on('error', reject);
      },
    );

    req.on('timeout', () => req.destroy(new Error('fetch timed out')));
    req.on('error', reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

export default ProfileUiRunner;
