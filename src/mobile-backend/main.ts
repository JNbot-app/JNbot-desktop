/* eslint-disable @typescript-eslint/no-var-requires */
import { BACKEND, type Address, type TransportFrame } from '../common/messaging';
import { unrestrictedPermissions } from '../common/clientPermissions';
import type { DropboxAccounts, DropboxCredentials, DropboxCredentialStore, StorageModeService, StorageMode } from '../main/src/functions/storage/StorageModeService';
import type { CliRuntime } from '../cli/v2/types';

const bridge = require('rn-bridge') as RnBridge;

type BridgeMessage =
  | { kind: 'start'; credentials?: DropboxAccounts | DropboxCredentials | null; session?: string }
  | { kind: 'frame'; frame: TransportFrame }
  | { kind: 'health' }
  | { kind: 'storage-request'; id: number; action: 'status' | 'begin-login' | 'complete-login' | 'select' | 'disconnect' | 'flush' | 'refresh' | 'transfer'; code?: string; verifier?: string; mode?: StorageMode; accountId?: string }
  | { kind: 'credentials-result'; id: number; error?: string };

type NodeErrorDetails = {
  source: string;
  message: string;
  stack?: string;
  script?: string;
  instanceId?: number;
  exitCode?: number;
};

type RnBridge = {
  app: { datadir: () => string };
  channel: { on: (event: string, listener: (message: BridgeMessage) => void) => void; send: (message: unknown) => void };
};

let started = false;
/** The app's current start handshake; its retries must not be announced again. */
let announcedSession: string | undefined;
let registration: { address: Address; receive(frame: TransportFrame): void; dispose(): void } | null = null;
let bootstrapFrame: TransportFrame | null = null;
let runtime: CliRuntime | null = null;
let storageMode: StorageModeService | null = null;
let removeBootstrapListener: (() => void) | null = null;
let credentials: DropboxAccounts = { accounts: [] };
let credentialRequestId = 0;
const credentialRequests = new Map<number, { resolve(): void; reject(error: Error): void }>();
let transition: Promise<void> = Promise.resolve();

const credentialStore: DropboxCredentialStore = {
  async read() { return credentials; },
  async write(value) {
    await persistCredentials(value);
    credentials = value;
  },
};

function persistCredentials(value: DropboxAccounts): Promise<void> {
  const id = ++credentialRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      credentialRequests.delete(id);
      reject(new Error('Mobile credential storage timed out.'));
    }, 30_000);
    credentialRequests.set(id, {
      resolve: () => { clearTimeout(timeout); resolve(); },
      reject: (error) => { clearTimeout(timeout); reject(error); },
    });
    send({ kind: 'credentials-write', id, value });
  });
}

function send(message: unknown) {
  console.log('[mobile-backend] send', { kind: (message as { kind?: unknown })?.kind });
  bridge.channel.send(message);
}

function debug(phase: string) {
  const memory = process.memoryUsage();
  send({ kind: 'debug', phase, rss: memory.rss, heapUsed: memory.heapUsed });
}

function errorDetails(source: string, error: unknown): NodeErrorDetails {
  if (error instanceof Error)
    return { source, message: error.message, stack: error.stack };
  return {
    source,
    message: typeof error === 'string' ? error : String(error),
  };
}

/**
 * The embedded Node process cannot load React Native's Sentry SDK. Forward a
 * sanitized diagnostic across the native bridge so the app can report it.
 */
function reportNodeError(details: NodeErrorDetails) {
  console.error('[mobile-backend] node error', details);
  try {
    send({ kind: 'node-error', ...details });
  } catch (bridgeError) {
    console.error('[mobile-backend] failed to forward node error', bridgeError);
  }
}

process.on('uncaughtException', (error) =>
  reportNodeError(errorDetails('backend:uncaughtException', error)),
);
process.on('unhandledRejection', (reason) =>
  reportNodeError(errorDetails('backend:unhandledRejection', reason)),
);
process.on('jnbot-mobile-error', (details: NodeErrorDetails) =>
  reportNodeError(details),
);

/**
 * Node.js Mobile keeps this module alive for the lifetime of the native app,
 * while React can replace its local runtime when the user switches back to
 * "Use this phone". Replaying the handshake lets that new JS runtime attach
 * to the existing backend client instead of waiting for a second Node start.
 */
function announceReady() {
  if (!registration || !bootstrapFrame) return false;
  send({ kind: 'assigned', address: registration.address });
  send({ kind: 'frame', frame: bootstrapFrame });
  send({ kind: 'ready' });
  return true;
}

async function start(initialCredentials?: DropboxAccounts | DropboxCredentials | null, session?: string) {
  // Handshakes are retried until acknowledged; answer each session once, also
  // when its startup failed, so queued retries do not rerun a failed start.
  if (session && session === announcedSession) return;
  if (started) {
    if (announceReady()) announcedSession = session;
    return;
  }
  started = true;
  announcedSession = session;
  try {
    console.log('[mobile-backend] start begin', {
      cwd: process.cwd(),
      dirname: __dirname,
      hasApp: Boolean(bridge.app),
      datadirType: typeof bridge.app?.datadir,
    });
    // `src/cli/mocks` reads this at module evaluation time. Set it before the
    // backend import so every persistent path lands in the native app sandbox.
    const dataDir = bridge.app.datadir();
    console.log('[mobile-backend] native data directory', {
      type: typeof dataDir,
      value: typeof dataDir === 'string' ? dataDir : undefined,
    });
    if (typeof dataDir !== 'string' || dataDir.length === 0) throw new Error('Native data directory is unavailable.');
    // rn-bridge resolves and owns the platform-specific writable directory:
    // Documents on iOS and the app files directory on Android. Use it as-is;
    // deriving or creating a second platform path is both unnecessary and can
    // fail before the native container has materialized all parent folders.
    process.env.JNBOT_USER_DATA = dataDir;
    process.env.JNBOT_MOBILE_RUNTIME = 'true';
    process.env.JNBOT_WORKER_ROOT = __dirname;
    // Do not create a throwaway worker here. A second V8 isolate during app
    // launch materially increases peak RSS on iOS. Real script workers remain
    // lazy and are created only when the user starts automation.
    console.log('[mobile-backend] importing runtime');
    const [{ createCliRuntime }, { backendMessaging }, { createClientBootstrap }, { StorageModeService, parseDropboxAccounts }, { DROPBOX_APP_KEY, DropboxHttp }] = await Promise.all([
      import('../cli/v2/runtime'),
      import('../main/src/messaging'),
      import('../main/src/messaging/bootstrap'),
      import('../main/src/functions/storage/StorageModeService'),
      import('../main/src/functions/storage/DropboxHttp'),
    ]);
    debug('after-runtime-imports');
    console.log('[mobile-backend] runtime modules imported');
    debug('before-cli-runtime');
    credentials = initialCredentials ? parseDropboxAccounts(initialCredentials) : { accounts: [] };
    storageMode = new StorageModeService(new DropboxHttp(DROPBOX_APP_KEY), credentialStore);
    const currentRuntime = await createCliRuntime({ kind: 'mobile', onPhase: debug, storageMode });
    runtime = currentRuntime;
    debug('after-cli-runtime');
    console.log('[mobile-backend] CLI runtime created');
    registration = backendMessaging.registerRemoteClient(
      (frame) => send({ kind: 'frame', frame }),
      { kind: 'trusted-local', subjectId: 'mobile', permissions: unrestrictedPermissions() },
    );
    const buildBootstrap = (address: Address) => {
      bootstrapFrame = { envelope: {
        version: 1, type: 'send', event: 'remote:bootstrap', from: BACKEND,
        to: address, data: createClientBootstrap(currentRuntime.handler.settings, {
          kind: 'trusted-local', subjectId: 'mobile', permissions: unrestrictedPermissions(),
        }),
      } };
      return bootstrapFrame;
    };
    // The first frame goes out with announceReady(), after the app has its
    // address; sending it earlier would be dropped by the app.
    buildBootstrap(registration.address);
    const pushBootstrap = () => {
      if (registration) send({ kind: 'frame', frame: buildBootstrap(registration.address) });
    };
    currentRuntime.handler.settings.on('JNdata', pushBootstrap);
    removeBootstrapListener = () => currentRuntime.handler.settings.off('JNdata', pushBootstrap);
    announceReady();
  } catch (error) {
    started = false;
    bootstrapFrame = null;
    // A partial startup may already have locked the storage root; free it so
    // the next attempt can select its own (e.g. a Dropbox memory root).
    const { releasePortableRoot } = await import('../main/src/functions/storage/portablePaths');
    releasePortableRoot();
    const message = error instanceof Error ? error.message : String(error);
    console.error('[mobile-backend] startup failed', error);
    send({ kind: 'fatal', code: 'UNSUPPORTED_LOCAL_RUNTIME', message });
  }
}

async function stop() {
  removeBootstrapListener?.();
  removeBootstrapListener = null;
  registration?.dispose();
  registration = null;
  bootstrapFrame = null;
  const current = runtime;
  runtime = null;
  try {
    await current?.close();
  } finally {
    const { releasePortableRoot } = await import('../main/src/functions/storage/portablePaths');
    releasePortableRoot();
    started = false;
  }
}

async function storageRequest(message: Extract<BridgeMessage, { kind: 'storage-request' }>) {
  const respond = (value?: unknown, error?: string) => send({ kind: 'storage-result', id: message.id, value, error });
  try {
    if (!storageMode) throw new Error('Local storage is not initialized.');
    let value: unknown;
    switch (message.action) {
      case 'status': value = await storageMode.status(); break;
      case 'begin-login': value = storageMode.beginLogin(); break;
      case 'complete-login': value = await storageMode.completeLogin(message.code ?? '', message.verifier ?? ''); break;
      case 'flush': value = await storageMode.flush(); break;
      case 'transfer': {
        const flush = await storageMode.flush();
        if (flush?.lastError) throw new Error(flush.lastError);
        value = await storageMode.transfer(message.accountId);
        break;
      }
      case 'refresh': {
        const result = await storageMode.flush();
        if (result?.lastError) throw new Error(result.lastError);
        if (runtime?.handler.getRuntimeSummaries().some((summary) => summary.bots || summary.scripts)) {
          value = false;
          break;
        }
        value = await storageMode.refreshNeeded();
        break;
      }
      case 'disconnect': {
        await storageMode.disconnect(message.accountId);
        value = await storageMode.status();
        break;
      }
      case 'select': {
        const flush = await storageMode.flush();
        if (flush?.lastError) throw new Error(flush.lastError);
        if (!message.mode) throw new Error('Select Local or Dropbox.');
        if (message.mode === 'dropbox') await storageMode.select(message.mode, message.accountId);
        await stop();
        if (message.mode === 'local') await storageMode.select(message.mode);
        value = await storageMode.status();
        // Reply before startup so the native side can reconnect its runtime.
        respond(value);
        await start(credentials);
        return;
      }
    }
    respond(value);
  } catch (error) {
    respond(undefined, error instanceof Error ? error.message : String(error));
  }
}

console.log('[mobile-backend] module loaded', {
  cwd: process.cwd(),
  dirname: __dirname,
  hasChannel: Boolean(bridge.channel),
  hasApp: Boolean(bridge.app),
});
debug('module-loaded');
bridge.channel.on('message', (message:any) => {
  console.log('[mobile-backend] received message', { kind: (message as { kind?: unknown })?.kind });
  if (!message || typeof message !== 'object') return;
  if (message.kind === 'start') transition = transition.then(() => start(message.credentials, message.session)).catch((error) => reportNodeError(errorDetails('backend:start', error)));
  else if (message.kind === 'frame') registration?.receive(message.frame);
  else if (message.kind === 'health') send({ kind: 'health', ready: !!registration });
  else if (message.kind === 'credentials-result') {
    const request = credentialRequests.get(message.id);
    credentialRequests.delete(message.id);
    if (request) message.error ? request.reject(new Error(message.error)) : request.resolve();
  }
  else if (message.kind === 'storage-request') transition = transition.then(() => storageRequest(message)).catch((error) => reportNodeError(errorDetails('backend:storage', error)));
});
