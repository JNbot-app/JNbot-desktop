import childProcess from 'child_process';

const startBackend = jest.fn(async () => ({}));
const showExistingWindow = jest.fn();

jest.mock('../../src/main/init', () => ({}));
jest.mock('../../src/main/src/index', () => ({
  __esModule: true,
  default: startBackend,
  errorHandler: { setReporter: jest.fn() },
  subscribeRuntimeSummaries: jest.fn(),
}));
jest.mock('../../src/main/DesktopBackgroundMode', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    show: showExistingWindow,
    updateSummary: jest.fn(),
  })),
}));
jest.mock('../../src/main/menu', () => ({
  __esModule: true,
  default: jest.fn(() => ({ buildMenu: jest.fn() })),
}));
jest.mock('../../src/main/updater', () => ({
  __esModule: true,
  default: jest.fn(),
}));
const openWebUrl = jest.fn();
jest.mock('../../src/main/util', () => ({
  resolveHtmlPath: () => 'file:///test/index.html',
  openWebUrl: (url: string) => openWebUrl(url),
}));
jest.mock('../../src/main/src/functions/minecraft/bridge', () => ({
  stopMcBridgeServer: jest.fn(),
}));
jest.mock('@sentry/electron/main', () => ({ init: jest.fn() }));
jest.mock('electron', () => {
  const { EventEmitter } = jest.requireActual('events');
  return {
    app: Object.assign(new EventEmitter(), {
      setAppUserModelId: jest.fn(),
      requestSingleInstanceLock: jest.fn(() => true),
      setAsDefaultProtocolClient: jest.fn(),
      whenReady: jest.fn(async () => undefined),
      quit: jest.fn(),
      isPackaged: false,
    }),
    ipcMain: { handle: jest.fn() },
    screen: { getAllDisplays: () => [{ size: { width: 1200, height: 900 } }] },
    BrowserWindow: jest.fn(() =>
      Object.assign(new EventEmitter(), {
        webContents: Object.assign(new EventEmitter(), { send: jest.fn() }),
        loadURL: jest.fn(),
      }),
    ),
  };
});

const originalExecSync = childProcess.execSync;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

afterEach(() => {
  childProcess.execSync = originalExecSync;
});

test('repeated launch and macOS activation restore one window and backend', async () => {
  const { app, BrowserWindow }: typeof import('electron') = require('electron');
  require('../../src/main/main');
  await new Promise(setImmediate);
  expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
  expect(BrowserWindow).toHaveBeenCalledTimes(1);
  expect(startBackend).toHaveBeenCalledTimes(1);
  app.emit('second-instance', {}, []);
  app.emit('activate');
  expect(showExistingWindow).toHaveBeenCalledTimes(2);
  expect(BrowserWindow).toHaveBeenCalledTimes(1);
  expect(startBackend).toHaveBeenCalledTimes(1);
});

test('a second process exits before creating a window or starting a backend', async () => {
  const { app, BrowserWindow }: typeof import('electron') = require('electron');
  jest.mocked(app.requestSingleInstanceLock).mockReturnValue(false);
  require('../../src/main/main');
  await new Promise(setImmediate);
  expect(app.quit).toHaveBeenCalledTimes(1);
  expect(BrowserWindow).not.toHaveBeenCalled();
  expect(startBackend).not.toHaveBeenCalled();
});

test('the main window only navigates within the app and never opens popups', async () => {
  const { app, BrowserWindow }: typeof import('electron') = require('electron');
  require('../../src/main/main');
  await new Promise(setImmediate);
  const { webContents } = jest.mocked(BrowserWindow).mock.results[0].value;

  const navigate = (url: string) => {
    const event = { preventDefault: jest.fn() };
    webContents.emit('will-navigate', event, url);
    return event.preventDefault;
  };
  expect(navigate('file:///test/index.html?redirect=/bots')).not.toHaveBeenCalled();
  for (const url of [
    'https://evil.example/index.html',
    'https://evil.example/?jartexnetwork.com',
    'file:///etc/index.html',
  ]) {
    expect(navigate(url)).toHaveBeenCalled();
    expect(openWebUrl).toHaveBeenLastCalledWith(url);
  }

  const contents = { setWindowOpenHandler: jest.fn(), on: jest.fn() };
  app.emit('web-contents-created', {}, contents);
  const handler = contents.setWindowOpenHandler.mock.calls[0][0];
  expect(handler({ url: 'https://modrinth.com' })).toEqual({ action: 'deny' });
  expect(openWebUrl).toHaveBeenLastCalledWith('https://modrinth.com');
  const attach = contents.on.mock.calls.find(([name]) => name === 'will-attach-webview')[1];
  const attachEvent = { preventDefault: jest.fn() };
  attach(attachEvent);
  expect(attachEvent.preventDefault).toHaveBeenCalled();
});
