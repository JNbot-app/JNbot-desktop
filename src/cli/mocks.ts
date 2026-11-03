import os from 'os';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import packageJson from '../../release/app/package.json';
// Mock Electron modules before importing anything else
// Create a complete Electron mock environment
const homedir = os.homedir();
const appDataDir =
  process.platform === 'win32'
    ? path.join(homedir, 'AppData', 'Roaming')
    : process.platform === 'darwin'
      ? path.join(homedir, 'Library', 'Application Support')
      : path.join(homedir, '.config');
const userDataDir = process.env.JNBOT_USER_DATA || path.join(appDataDir, 'JNbot');

// Create necessary directories
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

// Create a mock IPC system using EventEmitter
const mockIpcMain = new EventEmitter();

// Make sure the electron module is properly mocked before any imports
// This must be at the top to catch all direct and indirect electron imports
const electronMock = {
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      switch (name) {
        case 'home':
          return homedir;
        case 'appData':
          return appDataDir;
        case 'userData':
          return userDataDir;
        case 'temp':
          return os.tmpdir();
        case 'exe':
          return process.execPath;
        case 'desktop':
          return path.join(homedir, 'Desktop');
        case 'documents':
          return path.join(homedir, 'Documents');
        case 'downloads':
          return path.join(homedir, 'Downloads');
        case 'music':
          return path.join(homedir, 'Music');
        case 'pictures':
          return path.join(homedir, 'Pictures');
        case 'videos':
          return path.join(homedir, 'Videos');
        case 'logs':
          return path.join(userDataDir, 'logs');
        case 'crashDumps':
          return path.join(userDataDir, 'crashDumps');
        case 'recent':
          return path.join(userDataDir, 'recent');
        default:
          return path.join(userDataDir, name);
      }
    },
    getAppPath: () => process.cwd(),
    quit: () => process.exit(0),
    exit: (code = 0) => process.exit(code),
    relaunch: () => console.log('[Mock] App would relaunch here'),
    on: () => electronMock.app,
    once: () => electronMock.app,
    whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true,
    commandLine: {
      appendSwitch: () => {},
    },
    getVersion: () => packageJson.version + '-cli',
  },
  BrowserWindow: class MockBrowserWindow {
    isDestroyed() {
      return false;
    }
    webContents = {
      isDestroyed: () => false,
      send: () => {},
      on: () => {},
      setWindowOpenHandler: () => {},
    };
    loadURL() {
      return Promise.resolve();
    }
    on() {
      return this;
    }
    show() {}
    minimize() {}
  },
  ipcMain: {
    on: (channel: any, listener: Function) => {
      mockIpcMain.on(channel, listener);
      return mockIpcMain;
    },
    once: (channel: any, listener) => {
      mockIpcMain.once(channel, listener);
      return mockIpcMain;
    },
    removeListener: (channel: any, listener) => {
      mockIpcMain.removeListener(channel, listener);
      return mockIpcMain;
    },
    removeAllListeners: (channel: any) => {
      mockIpcMain.removeAllListeners(channel);
      return mockIpcMain;
    },
    handle(channel: any, listener: Function) {
      mockIpcMain.on(channel, listener);
      return mockIpcMain;
    },
    emit(channel: any, ...args: any) {
      // Match real Electron's ipcMain.emit (EventEmitter.emit): forward args
      // verbatim. Callers already pass the origin/event as the first arg
      // (see ClientEvents' socket bridge and emitEvent), so prepending another
      // null here shifts every handler's arguments — which made
      // `appSettings-update` treat the socket Origin as the appSettings payload
      // and try to JSON.stringify a circular PeerConnection on save.
      return mockIpcMain.emit(channel, ...args);
    },
  },
  Notification: class MockNotification {
    constructor(options) {
      this.title = options.title;
      this.body = options.body;
    }
    show() {
      console.log(`\n[Notification] ${this.title}: ${this.body}\n`);
    }
  },
  shell: {
    openExternal: (url: any) => {
      console.log(`[Mock] Would open external URL: ${url}`);
      return Promise.resolve();
    },
  },
  screen: {
    getAllDisplays: () => [
      {
        size: { width: 1200, height: 800 },
      },
    ],
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
    showErrorBox: () => {},
    showCertificateTrustDialog: async () => {},
  },
};

// The CLI esbuild plugin resolves every Electron import to this global mock.
global.electron = electronMock;
export { electronMock as electron, mockIpcMain as ipcMain };
