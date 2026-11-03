/**
 * Manual mock for `electron`, auto-applied by Jest to every test that imports
 * (directly or transitively) the `electron` package.
 *
 * Why this exists: the main-process modules under test (Settings, Profiles,
 * Storage, …) read `app.getPath('userData')` *at import time* and register
 * `ipcMain` handlers. There is no real Electron in Jest, so we fake just enough
 * of the surface they touch and point `userData` at a throwaway temp dir.
 *
 * Per-test isolation: tests call `__setUserDataDir()` (usually via the
 * `freshUserData()` helper) BEFORE `jest.resetModules()` + re-`require` of the
 * module under test, so each test gets a clean on-disk state. The captured ipc
 * handlers are also reset so handler-driven tests don't bleed into each other.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';

let userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-test-'));

export function __setUserDataDir(dir: string): void {
  userDataDir = dir;
}
export function __getUserDataDir(): string {
  return userDataDir;
}

/** ipcMain.on(channel, cb) registrations, keyed by channel. */
const onHandlers = new Map<string, (...args: any[]) => any>();
/** ipcMain.handle(channel, cb) registrations, keyed by channel. */
const invokeHandlers = new Map<string, (...args: any[]) => any>();

export const app = {
  getPath: (name: string): string => {
    if (name === 'userData') return userDataDir;
    return path.join(userDataDir, name);
  },
  getName: () => 'jnbot',
  getVersion: () => '0.0.0-test',
  getAppPath: () => userDataDir,
  on: jest.fn(),
  once: jest.fn(),
  quit: jest.fn(),
  whenReady: jest.fn(async () => undefined),
  isPackaged: false,
};

export const ipcMain = {
  on: jest.fn((channel: string, cb: (...args: any[]) => any) => {
    onHandlers.set(channel, cb);
  }),
  once: jest.fn((channel: string, cb: (...args: any[]) => any) => {
    onHandlers.set(channel, cb);
  }),
  handle: jest.fn((channel: string, cb: (...args: any[]) => any) => {
    invokeHandlers.set(channel, cb);
  }),
  handleOnce: jest.fn((channel: string, cb: (...args: any[]) => any) => {
    invokeHandlers.set(channel, cb);
  }),
  removeHandler: jest.fn((channel: string) => invokeHandlers.delete(channel)),
  removeAllListeners: jest.fn((channel?: string) => {
    if (channel) onHandlers.delete(channel);
    else onHandlers.clear();
  }),
  /** Test helpers — fire a registered handler directly. */
  __emit: (channel: string, ...args: any[]) => onHandlers.get(channel)?.(...args),
  __invoke: (channel: string, ...args: any[]) =>
    invokeHandlers.get(channel)?.({}, ...args),
  __onHandlers: onHandlers,
  __invokeHandlers: invokeHandlers,
};

const noopWebContents = {
  send: jest.fn(),
  on: jest.fn(),
  executeJavaScript: jest.fn(async () => undefined),
};

export class BrowserWindow {
  webContents = noopWebContents;
  static getAllWindows = jest.fn(() => [] as BrowserWindow[]);
  static fromId = jest.fn(() => undefined);
  on = jest.fn();
  once = jest.fn();
  loadURL = jest.fn();
  show = jest.fn();
  isDestroyed = jest.fn(() => false);
}

export const dialog = {
  showMessageBox: jest.fn(async () => ({ response: 0, checkboxChecked: false })),
  showMessageBoxSync: jest.fn(() => 0),
  showSaveDialog: jest.fn(async () => ({ canceled: true, filePath: undefined })),
  showOpenDialog: jest.fn(async () => ({ canceled: true, filePaths: [] })),
  showErrorBox: jest.fn(),
};

export const ipcRenderer = {
  on: jest.fn(),
  once: jest.fn(),
  send: jest.fn(),
  invoke: jest.fn(async () => undefined),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn(),
};

export const shell = {
  openExternal: jest.fn(async () => undefined),
  openPath: jest.fn(async () => ''),
  showItemInFolder: jest.fn(),
  trashItem: jest.fn(async () => undefined),
};

export const nativeTheme = { shouldUseDarkColors: false, on: jest.fn() };

export const Notification = class {
  show = jest.fn();
  on = jest.fn();
};

export default {
  app,
  ipcMain,
  ipcRenderer,
  BrowserWindow,
  dialog,
  shell,
  nativeTheme,
  Notification,
};
