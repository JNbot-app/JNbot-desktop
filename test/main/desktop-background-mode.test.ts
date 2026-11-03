import {
  app,
  autoUpdater,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  Tray,
} from 'electron';
import fs from 'fs';
import path from 'path';
import DesktopBackgroundMode from '../../src/main/DesktopBackgroundMode';
import {
  selectPortableRoot,
  releasePortableRoot,
  isPortableFile,
} from '../../src/main/src/functions/storage/portablePaths';
import { cleanupUserData, freshUserData } from './helpers';
import {
  __setUserDataDir,
  ipcMain as mockIpcMain,
} from '../../__mocks__/electron';

jest.mock('electron', () => {
  const { EventEmitter } = jest.requireActual('events');
  const base = jest.requireActual('../../__mocks__/electron');
  return {
    ...base,
    app: Object.assign(new EventEmitter(), {
      getPath: base.app.getPath,
      quit: jest.fn(),
    }),
    autoUpdater: new EventEmitter(),
    powerMonitor: new EventEmitter(),
    BrowserWindow: jest.fn().mockImplementation(() => {
      let visible = true;
      return Object.assign(new EventEmitter(), {
        webContents: {},
        hide: jest.fn(() => {
          visible = false;
        }),
        show: jest.fn(() => {
          visible = true;
        }),
        focus: jest.fn(),
        restore: jest.fn(),
        isMinimized: jest.fn(() => false),
        isVisible: jest.fn(() => visible),
        isDestroyed: jest.fn(() => false),
      });
    }),
    nativeImage: {
      createFromPath: jest.fn(() => ({
        isEmpty: () => false,
        setTemplateImage: jest.fn(),
      })),
    },
    Tray: jest.fn().mockImplementation(() =>
      Object.assign(new EventEmitter(), {
        destroy: jest.fn(),
        setToolTip: jest.fn(),
        setContextMenu: jest.fn(),
      }),
    ),
    Menu: { buildFromTemplate: jest.fn((template) => template) },
  };
});

let directory: string;
let window: BrowserWindow;
let mode: DesktopBackgroundMode;

function preference(channel: string, ...args: unknown[]): boolean {
  const handler = mockIpcMain.__invokeHandlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender: window.webContents }, ...args);
}

function tray(): Tray {
  const result = jest.mocked(Tray).mock.results[0];
  if (!result || result.type !== 'return')
    throw new Error('No tray was created.');
  return result.value;
}

function closeWindow() {
  const event = { preventDefault: jest.fn() };
  window.emit('close', event);
  return event;
}

beforeEach(() => {
  jest.clearAllMocks();
  app.removeAllListeners();
  autoUpdater.removeAllListeners();
  powerMonitor.removeAllListeners();
  directory = freshUserData();
  __setUserDataDir(directory);
  window = new BrowserWindow();
  mode = new DesktopBackgroundMode(window, (name) =>
    path.join('/assets', name),
  );
});

afterEach(() => {
  releasePortableRoot();
  jest.restoreAllMocks();
});

afterAll(cleanupUserData);

test('defaults off and allows normal window closing', () => {
  expect(preference('desktop:background:get')).toBe(false);
  expect(closeWindow().preventDefault).not.toHaveBeenCalled();
  expect(Tray).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(directory, 'desktop-settings.json'))).toBe(
    false,
  );
});

test('hides and restores the same window without quitting, even while idle', () => {
  expect(preference('desktop:background:set', true)).toBe(true);
  expect(closeWindow().preventDefault).toHaveBeenCalledTimes(1);
  expect(window.hide).toHaveBeenCalledTimes(1);
  expect(app.quit).not.toHaveBeenCalled();
  jest.spyOn(window, 'isMinimized').mockReturnValue(true);
  mode.show();
  expect(window.restore).toHaveBeenCalledTimes(1);
  expect(window.show).toHaveBeenCalledTimes(1);
  expect(window.focus).toHaveBeenCalledTimes(1);
  expect(BrowserWindow).toHaveBeenCalledTimes(1);
});

test('persists on this device, independently of portable data', () => {
  const portableDirectory = freshUserData();
  selectPortableRoot(portableDirectory);
  preference('desktop:background:set', true);
  expect(
    JSON.parse(
      fs.readFileSync(path.join(directory, 'desktop-settings.json'), 'utf8'),
    ),
  ).toEqual({ keepRunningOnClose: true });
  expect(isPortableFile('desktop-settings.json')).toBe(false);
  expect(
    fs.existsSync(path.join(portableDirectory, 'desktop-settings.json')),
  ).toBe(false);
  app.emit('will-quit');
  jest.mocked(ipcMain.handle).mockClear();
  mode = new DesktopBackgroundMode(window, (name) => name);
  expect(preference('desktop:background:get')).toBe(true);
});

test('updates counts across profiles and removes ended activity', () => {
  preference('desktop:background:set', true);
  mode.updateSummary({ profileKey: 'first', bots: 2, scripts: 1 });
  mode.updateSummary({ profileKey: 'second', bots: 3, scripts: 2 });
  expect(tray().setToolTip).toHaveBeenLastCalledWith(
    'JNbot — 5 bots · 3 scripts',
  );
  mode.updateSummary({ profileKey: 'first', bots: 0, scripts: 0 });
  mode.updateSummary({ profileKey: 'second', bots: 0, scripts: 0 });
  expect(tray().setToolTip).toHaveBeenLastCalledWith(
    'JNbot — 0 bots · 0 scripts',
  );
  const calls = jest.mocked(Menu.buildFromTemplate).mock.calls.length;
  mode.updateSummary({ profileKey: 'second', bots: 0, scripts: 0 });
  expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(calls);
});

test('restores a hidden window before disabling its tray', () => {
  preference('desktop:background:set', true);
  closeWindow();
  preference('desktop:background:set', false);
  expect(window.isVisible()).toBe(true);
  expect(tray().destroy).toHaveBeenCalledTimes(1);
  expect(closeWindow().preventDefault).not.toHaveBeenCalled();
});

test.each(['quit', 'update', 'shutdown', 'session-end'])(
  '%s bypasses hiding',
  (reason) => {
    preference('desktop:background:set', true);
    if (reason === 'quit')
      app.emit('before-quit', { preventDefault: jest.fn() });
    if (reason === 'update') autoUpdater.emit('before-quit-for-update');
    if (reason === 'shutdown') powerMonitor.emit('shutdown');
    if (reason === 'session-end') window.emit('session-end');
    expect(closeWindow().preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  },
);

test('tray menu opens the existing window and quits explicitly', () => {
  preference('desktop:background:set', true);
  closeWindow();
  const template = jest.mocked(Menu.buildFromTemplate).mock.calls[0][0];
  const open = template.find((item) => item.label === 'Open JNbot');
  const quit = template.find((item) => item.label === 'Quit JNbot');
  expect(open?.click).toBeDefined();
  expect(quit?.click).toBeDefined();
  if (open?.click) Reflect.apply(open.click, undefined, []);
  expect(window.isVisible()).toBe(true);
  if (quit?.click) Reflect.apply(quit.click, undefined, []);
  expect(app.quit).toHaveBeenCalledTimes(1);
});

test('tray failure leaves normal closing enabled without saving the preference', () => {
  jest.mocked(Tray).mockImplementationOnce(() => {
    throw new Error('Tray unavailable');
  });
  expect(() => preference('desktop:background:set', true)).toThrow(
    'Tray unavailable',
  );
  expect(preference('desktop:background:get')).toBe(false);
  expect(closeWindow().preventDefault).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(directory, 'desktop-settings.json'))).toBe(
    false,
  );
});

test('a missing tray image leaves the app accessible', () => {
  const image = nativeImage.createFromPath('/assets/empty.png');
  jest.spyOn(image, 'isEmpty').mockReturnValue(true);
  jest.mocked(nativeImage.createFromPath).mockReturnValueOnce(image);
  expect(() => preference('desktop:background:set', true)).toThrow('tray icon');
  expect(preference('desktop:background:get')).toBe(false);
  expect(closeWindow().preventDefault).not.toHaveBeenCalled();
});

test('failed persistence rolls back the tray and keeps ordinary close behavior', () => {
  jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
    throw new Error('Read-only storage');
  });
  expect(() => preference('desktop:background:set', true)).toThrow(
    'Read-only storage',
  );
  expect(tray().destroy).toHaveBeenCalledTimes(1);
  expect(preference('desktop:background:get')).toBe(false);
  expect(closeWindow().preventDefault).not.toHaveBeenCalled();
});

test('rejects invalid preferences and IPC calls from other windows', () => {
  expect(() => preference('desktop:background:set', 'true')).toThrow(
    'Expected a boolean',
  );
  const handler = mockIpcMain.__invokeHandlers.get('desktop:background:set');
  expect(() => handler?.({ sender: {} }, true)).toThrow(
    'require the main window',
  );
});

test('an unreadable saved preference falls back to ordinary closing', () => {
  fs.writeFileSync(
    path.join(directory, 'desktop-settings.json'),
    'invalid JSON',
  );
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  app.emit('will-quit');
  jest.mocked(ipcMain.handle).mockClear();
  mode = new DesktopBackgroundMode(window, (name) => name);
  expect(preference('desktop:background:get')).toBe(false);
  expect(closeWindow().preventDefault).not.toHaveBeenCalled();
});
