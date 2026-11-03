import path from 'path';
import fs from 'fs';
import { electron, ipcMain } from '../mocks';
import Settings from '../../main/src/functions/Settings';
import ScriptHandler from '../../main/src/functions/ScriptHandler';
import ErrorHandler from '../../main/src/functions/ErrorHandler';
import Macros, { type MacroDatabase } from '../../main/src/functions/Macros';
import ProfileScripts from '../../main/src/functions/ProfileScripts';
import ProfileUiRunner from '../../main/src/functions/ProfileUiRunner';
import WebRTC_nodejs from '../../common/WebRTC_nodejs';
import generateUID from '../../main/UID';
import { bindClientEventMessaging } from '../../main/src/messaging';
import type { BrowserWindow } from 'electron';
import type { CliRuntime } from './types';
import MixpanelActivityTracker from '../../main/src/functions/MixpanelActivityTracker';
import { createCliStorageModeService, type StorageModeService } from '../../main/src/functions/storage/StorageModeService';

const lockPath = path.join(electron.app.getPath('userData'), 'cli.session.lock');

function acquireSessionLock(): () => void {
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx', mode: 0o600 });
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    try {
      const { pid } = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: number };
      if (pid && pid !== process.pid) {
        process.kill(pid, 0);
        throw new Error(`Another JNbot CLI session is already running (pid ${pid}).`);
      }
    } catch (lockError: any) {
      if (lockError?.message?.startsWith('Another JNbot')) throw lockError;
    }
    fs.rmSync(lockPath, { force: true });
    return acquireSessionLock();
  }
  return () => fs.rmSync(lockPath, { force: true });
}

Object.defineProperty(process, 'resourcesPath', {
  configurable: true,
  get: () => path.join(process.cwd(), 'resources'),
});

function setupGlobals(handler: ScriptHandler): void {
  global.send = (event: string, data: unknown, socket?: unknown) => {
    if (socket !== false) handler.deviceHandler.broadcast(event, data);
  };
  global.broadcast = (event: string, data: unknown) => handler.deviceHandler.broadcast(event, data);
}

type RuntimeHost = {
  kind?: 'cli' | 'mobile';
  onPhase?: (phase: string) => void;
  storageMode?: StorageModeService;
};

export async function createCliRuntime(host: RuntimeHost = {}): Promise<CliRuntime> {

  global.isMobileRuntime = host.kind === 'mobile';
  global.isCLI = true;
  const releaseLock = acquireSessionLock();
  const storageMode = host.storageMode ?? createCliStorageModeService();
  try {
    await storageMode.prepareStartup();
  } catch (error) {
    releaseLock();
    throw error;
  }
  // Settings broadcasts during initialisation. The real broadcaster is wired
  // once ScriptHandler exists; until then these startup broadcasts have no
  // CLI recipient and must be harmless.
  global.send = () => undefined;
  global.broadcast = () => undefined;
  const uid = generateUID();
  const errorHandler = new ErrorHandler(uid);
  const activityTracker = new MixpanelActivityTracker();
  // This runtime deliberately has no MongoDB dependency; installed macros use disk.
  const db: MacroDatabase = {
    user: null,
    addActivity: (activity) => activityTracker.addActivity(activity),
  };

  const settings = new Settings();
  const macros = new Macros(db, settings);
  settings.profiles.scripts = new ProfileScripts(macros);
  new ProfileUiRunner(settings, settings.profiles.scripts);

  const webRTCHandler = WebRTC_nodejs.getInstance(uid, settings.shared.devices);
  const window = new electron.BrowserWindow();

  const handler = new ScriptHandler(
    settings,
    window as unknown as BrowserWindow,
    macros,
    errorHandler,
    webRTCHandler,
  );
  setupGlobals(handler);
  const unbindClientEvents = bindClientEventMessaging(Promise.resolve(handler.clientEvents));
  errorHandler.setScriptHandler(handler);
  ipcMain.emit('LOADED', null);

  let closed = false;
  return {
    handler,
    async close() {
      if (closed) return;
      closed = true;
      unbindClientEvents();
      for (const runtime of handler.getRuntimeSummaries()) {
        handler.stopAllScripts((handler.getRuntimeByKey(runtime.profileKey)!).profileId);
      }
      handler.deviceHandler.stop('peer2peer' as never);
      const { closeAiService } = await import('../../main/src/ai/AiService');
      await closeAiService();
      settings.close();
      try {
        await storageMode.close();
      } finally {
        releaseLock();
      }
    },
  };
}
