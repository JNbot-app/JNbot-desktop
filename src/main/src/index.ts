import { app, BrowserWindow, ipcMain, powerSaveBlocker, protocol, shell } from 'electron';
import generateUID from '../UID';

import ErrorHandler from './functions/ErrorHandler';
import type { AppSettings } from './types';
import fs from 'fs';

const UID = generateUID();
export const errorHandler = new ErrorHandler(UID);

process.on('uncaughtException', (err) => {
  errorHandler.handle({
    message: err.message,
    stack: err.stack,
    script: 'main process',
  });
});

process.on('unhandledRejection', (reason: any) => {
  console.error('Unhandled Rejection:', reason);
  errorHandler.handle({
    message: reason?.message || String(reason),
    stack: reason?.stack,
    script: 'main process',
  });
});

import ScriptHandler from './functions/ScriptHandler';
import Settings from './functions/Settings';
import Db from './functions/Db';
import Macros from './functions/Macros';
import { Socket } from './functions/peer2peer/Socket';
import WebRTC_nodejs from '../../common/WebRTC_nodejs';
import type ClientEvents_ from './functions/ClientEvents';
import { backendMessaging, bindClientEventMessaging } from './messaging';
import McpManager from './functions/mcp/McpManager';
import LlmService from './functions/llm/LlmService';
import { recipeActionCatalog } from '../../common/recipeCatalog';
import { DROPBOX_APP_KEY, DropboxHttp } from './functions/storage/DropboxHttp';
import { FileDropboxCredentialStore, StorageModeService, type StorageMode } from './functions/storage/StorageModeService';
import { devicePath } from './functions/storage/portablePaths';
import type { ProfileRuntimeSummary } from '../../common/profileRuntime';

backendMessaging.installElectron();

let storageService: StorageModeService | undefined;
let storageWindow: BrowserWindow | undefined;
let storageStartupError: string | undefined;
let storageStartupState: 'loading' | 'ready' | 'error' = 'loading';
let activeSettings: Settings | undefined;
let activeHandler: ScriptHandler | undefined;

export function subscribeRuntimeSummaries(
  listener: (summary: ProfileRuntimeSummary) => void,
): void {
  const handler = activeHandler;
  if (!handler) return;
  handler.getRuntimeSummaries().forEach(listener);
  handler.on('RUNTIME_SUMMARY_CHANGED', listener);
  app.once('will-quit', () => handler.off('RUNTIME_SUMMARY_CHANGED', listener));
}

let readyClientEvents: ClientEvents_ | undefined;
let rendererLoadedEarly = false;
const sendInitialDetails = () => {
  if (!readyClientEvents) return;
  readyClientEvents.sendDetails();
};
const getStorageService = () => storageService ??= new StorageModeService(
  new DropboxHttp(DROPBOX_APP_KEY),
  new FileDropboxCredentialStore(devicePath('dropbox-credentials.json')),
  undefined,
  (status) => {
    if (storageWindow && !storageWindow.isDestroyed() && !storageWindow.webContents.isDestroyed()) {
      storageWindow.webContents.send('storage:write-status', status);
    }
  },
);

ipcMain.handle('storage:status', async () => {
  try {
    return { ...(await getStorageService().status()), startupState: storageStartupState, startupError: storageStartupError };
  } catch (error) {
    return {
      mode: getStorageService().mode(),
      connected: false,
      startupState: 'error',
      startupError: error instanceof Error ? error.message : 'Dropbox credentials are unavailable.',
    };
  }
});
ipcMain.handle('storage:begin-login', () => getStorageService().beginLogin());
ipcMain.handle('storage:complete-login', (_event, code: string, verifier: string) =>
  getStorageService().completeLogin(code, verifier));
ipcMain.handle('storage:open-login', (_event, url: string) => {
  const target = new URL(url);
  if (target.origin !== 'https://www.dropbox.com' || target.pathname !== '/oauth2/authorize')
    throw new Error('Invalid Dropbox authorization URL.');
  return shell.openExternal(url);
});
ipcMain.handle('storage:select', async (_event, mode: StorageMode, accountId?: string) => {
  if (mode !== 'local' && mode !== 'dropbox') throw new Error('Invalid storage mode.');
  const flushed = await getStorageService().flush();
  if (mode === 'dropbox') await getStorageService().select(mode, accountId);
  for (const runtime of activeHandler?.getRuntimeSummaries() ?? []) {
    const profileId = activeHandler?.getRuntimeByKey(runtime.profileKey)?.profileId;
    if (profileId !== undefined) activeHandler?.stopAllScripts(profileId);
  }
  activeSettings?.close();
  const closed = await getStorageService().close();
  if (mode === 'local') await getStorageService().select(mode);
  setTimeout(() => { app.relaunch(); app.quit(); }, 1500);
  return { save: flushed?.lastError ? flushed : closed };
});
ipcMain.handle('storage:disconnect', async (_event, accountId?: string) => {
  await getStorageService().disconnect(accountId);
});
ipcMain.handle('storage:transfer', async (_event, accountId?: string) => {
  const flushed = await getStorageService().flush();
  if (flushed?.lastError) throw new Error(flushed.lastError);
  return getStorageService().transfer(accountId);
});
ipcMain.handle('storage:flush', () => getStorageService().flush());
ipcMain.handle('storage:retry', () => { app.relaunch(); app.quit(); });

const db = new Db(UID);
const login = async () => {
  await db.connect();
  await db.signin();
};
login();

// The `invoke`/`actions` IPC bridge (behind `ipcRenderer.get()` and
// `ipcRenderer.action()`) must exist before the window's renderer mounts and
// fires its first call — otherwise Electron logs "No handler registered for
// 'invoke'". The real dispatcher (ClientEvents) is only built later in main(),
// so register the channels at module load and forward to ClientEvents once
// it's ready. Early calls queue on the
// promise instead of erroring.
let resolveClientEvents: (ce: ClientEvents_) => void;
const clientEventsReady = new Promise<ClientEvents_>((resolve) => {
  resolveClientEvents = resolve;
});
bindClientEventMessaging(clientEventsReady);
// The renderer can finish loading while Dropbox data is still being read.
// Remember that signal and deliver initial state when the backend is ready.
ipcMain.on('LOADED', (event) => {
  if (event.sender !== storageWindow?.webContents) return;
  if (readyClientEvents) sendInitialDetails();
  else rendererLoadedEarly = true;
});
ipcMain.handle('invoke', async (e, [action, data]: [string, any]) =>
  (await clientEventsReady).action(action, data, e),
);
ipcMain.on('actions', async (e, [action, data]: [string, any]) =>
  (await clientEventsReady).action(action, data, e),
);

// Keeps the OS awake while `preventSleep` is enabled. Idempotent: starting
// when already active (or stopping when inactive) is a no-op.
let powerSaveBlockerId: number | null = null;
function applyPreventSleep(enabled: boolean) {
  if (enabled) {
    if (
      powerSaveBlockerId !== null &&
      powerSaveBlocker.isStarted(powerSaveBlockerId)
    )
      return;
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (powerSaveBlockerId !== null) {
    if (powerSaveBlocker.isStarted(powerSaveBlockerId))
      powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
}

async function main(mainWindow: BrowserWindow): Promise<Settings> {
  global.send = send;
  storageWindow = mainWindow;
  storageStartupState = 'loading';

  await getStorageService().prepareStartup();
  storageStartupError = undefined;
  storageStartupState = 'ready';

  console.info('Loading Settings...');
  const settings = new Settings();
  activeSettings = settings;
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    settings.close();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    void Promise.race([getStorageService().close().then(() => undefined), timeout]).finally(() => {
      quitting = true;
      app.quit();
    });
  });
  process.once('exit', (code) => {
    if (code === 0) settings.close();
  });
  const macros = new Macros(db, settings);
  // Wire Macros into Profiles so profile export/import can resolve script
  // info+code and emit self-contained bundles.
  {
    const ProfileScripts = require('./functions/ProfileScripts').default;
    const ProfileUiRunner = require('./functions/ProfileUiRunner').default;
    settings.profiles.scripts = new ProfileScripts(macros);
    new ProfileUiRunner(settings, settings.profiles.scripts);
  }
  console.info('Loading WebRTC_nodejs...');
  const webRTCHandler = WebRTC_nodejs.getInstance(UID, settings.shared.devices);

  const scriptHandler = new ScriptHandler(
    settings,
    mainWindow,
    macros,
    errorHandler,
    webRTCHandler,
  );
  activeHandler = scriptHandler;
  let away = false;
  let reloadPending = false;
  let checkingStorage = false;
  const refreshDropbox = async () => {
    if (!reloadPending || checkingStorage) return;
    checkingStorage = true;
    try {
      const save = await getStorageService().flush();
      if (save?.lastError) throw new Error(save.lastError);
      if (scriptHandler.getRuntimeSummaries().some((runtime) => runtime.bots || runtime.scripts)) return;
      const changed = await getStorageService().refreshNeeded();
      if (scriptHandler.getRuntimeSummaries().some((runtime) => runtime.bots || runtime.scripts)) return;
      reloadPending = false;
      if (changed) {
        app.relaunch();
        app.quit();
      }
      storageStartupError = undefined;
    } catch (error) {
      reloadPending = false;
      storageStartupError = error instanceof Error ? error.message : 'Dropbox refresh failed.';
      send('notification', {
        title: 'Dropbox storage',
        message: storageStartupError,
        type: 'error',
        buttons: [{ label: 'Open settings', action: 'openSettings', tab: 'storage' }],
      });
    } finally {
      checkingStorage = false;
    }
  };
  mainWindow.on('blur', () => { away = true; });
  mainWindow.on('focus', () => {
    if (!away || getStorageService().mode() !== 'dropbox') return;
    away = false;
    reloadPending = true;
    void refreshDropbox();
  });
  scriptHandler.on('RUNTIME_ACTIVITY_CHANGED', () => { if (reloadPending) void refreshDropbox(); });
  const mcpManager = new McpManager(scriptHandler, macros);
  scriptHandler.clientEvents.mcpManager = mcpManager;
  scriptHandler.llm = scriptHandler.clientEvents.llm = new LlmService(scriptHandler, mcpManager);
  app.once('before-quit', () => mcpManager.close());
  protocol.handle('jnbot', (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'docs' && url.pathname === '/plugin-api') {
      return new Response(mcpManager.pluginDocs(), {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    if (url.hostname === 'catalog' && url.pathname === '/recipes') {
      return new Response(JSON.stringify(recipeActionCatalog), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  });
  errorHandler.setScriptHandler(scriptHandler);
  // Backend is ready — release any renderer `get()`/`action()` calls that
  // arrived during startup (see clientEventsReady above).
  readyClientEvents = scriptHandler.clientEvents;
  resolveClientEvents(scriptHandler.clientEvents);
  if (rendererLoadedEarly) {
    rendererLoadedEarly = false;
    sendInitialDetails();
  }

  /** socket:
   *  undefined -> only send to main window & sockets
   *  Socket -> send to 1 socket,
   *  true -> broadcast to all sockets,
   *  false -> send to main window only
   **/
  function send(action: string, data?: any, socket?: Socket | boolean) {
    if (socket === true) {
      scriptHandler.deviceHandler.broadcast(action, data);
    } else if (socket === false) {
      scriptHandler.windowHandler.sendToAll(action, data);
    } else if (!socket) {
      scriptHandler.windowHandler.sendToAll(action, data);
      scriptHandler.deviceHandler.broadcast(action, data);
    } else if (typeof socket?.emit === 'function') {
      socket.emit(action, data);
    }
  }

  global.broadcast = (event, data) => {
    scriptHandler.deviceHandler.broadcast(event, data);
  };


  // Keep the PC awake while the app runs, if enabled. Re-applied whenever the
  // setting changes so toggling it takes effect without a restart.
  applyPreventSleep(!!settings.appSettings.preventSleep);
  settings.on('sharedAppSettings', (appSettings: AppSettings) => {
    applyPreventSleep(!!appSettings?.preventSleep);
  });

  // Discord bot
  if (settings.appSettings.discord_on_startup) {
    scriptHandler.runScript({ script: 'discordBot' });
  }

  // Check if read / write permissions
  fs.access(
    app.getPath('appData'),
    fs.constants.R_OK | fs.constants.W_OK,
    (err) => {
      if (err) {
        console.error(err.message);
        send('notification', {
          title: 'Permissions Error',
          message:
            'Please make sure you have read and write permissions, please open app as administrator.',
          type: 'warning',
        });
      }
    },
  );

  return settings;
}

export default async function startMain(mainWindow: BrowserWindow): Promise<Settings> {
  try {
    return await main(mainWindow);
  } catch (error) {
    storageStartupError = error instanceof Error ? error.message : 'JNbot could not initialize its data.';
    storageStartupState = 'error';
    mainWindow.webContents.send('storage:startup-error', storageStartupError);
    throw error;
  }
}
