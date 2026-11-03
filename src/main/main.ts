/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `release/app/dist/main/main.js` using esbuild. This gives us some performance wins.
 */



import './init';
import { app, BrowserWindow, screen, ipcMain } from 'electron';
import path from 'path';

/// ----------------- ///
// This should fix the 'Error: write EFAULT' for linux people
const child_process = require('child_process');
const originalExecSync = child_process.execSync;
child_process.execSync = (command: string, options?: any) => {
  if (typeof options === 'object' && options !== null) {
    return originalExecSync(command, { ...options, stdio: 'ignore' });
  } else {
    return originalExecSync(command, { stdio: 'ignore', encoding: options });
  }
};
app.setAppUserModelId('com.jnbot');
/// ----------------- ///

import main, { errorHandler, subscribeRuntimeSummaries } from './src/index';
import DesktopBackgroundMode from './DesktopBackgroundMode';
import MenuBuilder from './menu';
import { openWebUrl, resolveHtmlPath } from './util';
import updater from './updater';
import * as Sentry from '@sentry/electron/main';
import fs from 'fs';
import { stopMcBridgeServer } from './src/functions/minecraft/bridge';
import { registerShareDeepLinks } from './shareDeepLinks';

console.info('Starting main process');
if (process.env.NODE_ENV !== 'development') {
  console.info('Starting sentry');
  Sentry.init({
    dsn: 'https://89a9be3c43c9447abcfdb0d9f08845b7@o530070.ingest.sentry.io/4504833093074944',
  });
}

let mainWindow: BrowserWindow | null | any = null;
let serverActive = false;
let isFocused = true;
let updateInterval: NodeJS.Timeout | null = null;
let backgroundMode: DesktopBackgroundMode | undefined;
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

const openSecondInstanceLink = registerShareDeepLinks(
  () => mainWindow,
  () => backgroundMode?.show(),
);
app.on('second-instance', (_event, argv) => {
  backgroundMode?.show();
  openSecondInstanceLink(argv);
});

const isMac = process.platform === 'darwin';

if (app.isPackaged) {
  const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
  if (!fs.existsSync(updateConfigPath)) {
    console.warn('app-update.yml not found:', updateConfigPath);
    try {
      fs.writeFileSync(
        updateConfigPath,
        `owner: usserwout
repo: JNbot-updater
provider: github
releaseType: release
updaterCacheDirName: jnbot-updater
`,
      );
      console.info('Created new app-update.yml');
    } catch (err) {
      console.warn('Failed to create app-update.yml (non-fatal)', err);
    }
  }
}

if (process.env.NODE_ENV === 'production') {
  console.info('Installing source map support...');
  try {
    const sourceMapSupport = require('source-map-support');
    sourceMapSupport.install();
  } catch (err) {
    console.error('Error installing source map support', err);
  }
}

const isDevelopment =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDevelopment) {
  require('electron-debug')({ showDevTools: false });
}

const installExtensions = async () => {
  const {
    default: installExtension,
    REACT_DEVELOPER_TOOLS,
  } = require('electron-devtools-installer');
  const forceDownload = Boolean(process.env.UPGRADE_EXTENSIONS);
  return installExtension([REACT_DEVELOPER_TOOLS], { forceDownload }).catch(
    console.info,
  );
};

const createWindow = async () => {
  if (isDevelopment && process.env.INSTALL_EXTENSIONS !== 'false') {
    void installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };
  const screenSize = screen.getAllDisplays()[0]?.size;

  mainWindow = new BrowserWindow({
    show: false,
    width: screenSize.width ?? 1200,
    minHeight: 200,
    minWidth: 400,
    height: screenSize.height ?? 900,
    title: 'JNbot',
    icon: isMac ? getAssetPath('icon.icns') : getAssetPath('icon.png'),
    backgroundColor: '#141414',
    transparent: isMac,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 22, y: 22 },
        }
      : {}),
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#141414',
            symbolColor: '#ffffff',
            height: 32,
          },
        }
      : {}),
  });

  // Start backend initialization concurrently with loading the renderer page.
  backgroundMode = new DesktopBackgroundMode(mainWindow, getAssetPath);
  const backendPromise = main(mainWindow)
    .then((settings) => {
      subscribeRuntimeSummaries((summary) => backgroundMode?.updateSummary(summary));
      return settings;
    })
    .catch((err) => {
      console.error('Error in main backend startup:', err);
      return null;
    });

  const url = isDevelopment
    ? 'http://localhost:1212'
    : resolveHtmlPath('index.html');
  console.info('Window created: ', url);
  mainWindow.loadURL(url);

  // Renderer-failure safety net. The renderer's own reporting (Sentry +
  // ErrorBoundary -> ERROR ipc) can only fire once the bundle has loaded and
  // React has mounted. A blank page on boot — a chunk that 404s, a corrupt
  // update, a module-load throw, or a renderer-process crash — never runs any
  // of that, so the main process is the only thing left that can report it.
  {
    const wc = mainWindow.webContents;

    wc.on('dom-ready', () => {});

    // The HTML/asset failed to load at all (bad path, missing/corrupt chunk).
    // Ignore aborts (-3) and benign sub-resource failures (only report the
    // top-level document load identified by isMainFrame).
    wc.on(
      'did-fail-load',
      (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (errorCode === -3) return; // ERR_ABORTED (navigations, redirects)
        if (!isMainFrame) return;
        errorHandler.handle({
          message: `Renderer did-fail-load (${errorCode}): ${errorDescription}`,
          stack: `URL: ${validatedURL}`,
          script: 'renderer (did-fail-load)',
        });
      },
    );

    // The renderer process crashed, was killed (OOM), or otherwise went away.
    wc.on('render-process-gone', (_e, details) => {
      errorHandler.handle({
        message: `Renderer process gone: ${details.reason}${
          details.exitCode != null ? ` (exit ${details.exitCode})` : ''
        }`,
        stack: JSON.stringify(details),
        script: 'renderer (render-process-gone)',
      });
    });

    // The preload script threw while loading — this also yields a blank page.
    wc.on('preload-error', (_e, preloadPath, error) => {
      errorHandler.handle({
        message: `Preload error: ${error?.message || String(error)}`,
        stack: error?.stack || `preload: ${preloadPath}`,
        script: 'renderer (preload-error)',
      });
    });
  }

  mainWindow.on('ready-to-show', async () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }

    if (!serverActive) {
      let settings;
      try {
        settings = await backendPromise;
        if (settings) {
          serverActive = true;

          const allowPrerelease = settings?.appSettings?.allowPrereleaseUpdates ?? false;
          checkForUpdated(allowPrerelease);
          if (updateInterval) clearInterval(updateInterval);
          // Pass allowPrerelease through to every periodic check — otherwise the
          // bare `checkForUpdated` reference falls back to its default (false)
          // and prerelease users stop seeing prereleases after the first check.
          updateInterval = setInterval(() => checkForUpdated(allowPrerelease), 1000 * 60 * 30); // check for updates every 30 minutes
        }
      } catch (e) {
        checkForUpdated();
      }

      function checkForUpdated(allowPrerelease = false) {
        if (!isFocused) return console.warn('Skipping update check because app is not focused');
        updater({
          send: (event: string, data?: any) =>
            mainWindow?.webContents?.send(event, data),
          UPDATE_PATH: app.getPath('appData') + '/Caches/jnbot-updater/pending',
          EXECUTABLE_PATH: app.getPath('exe'),
          ipcMain,
          reload: () => {
            app.relaunch();
            app.exit();
          },
          allowPrerelease: allowPrerelease,
        });
      }
    }
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    }
  });

  // The main window carries the privileged preload, so it may only ever show
  // the app itself; every other navigation goes to the user's browser.
  const appUrl = new URL(url);
  mainWindow.webContents.on('will-navigate', (e, target: string) => {
    let next: URL;
    try {
      next = new URL(target);
    } catch {
      e.preventDefault();
      return;
    }
    const isApp =
      next.protocol === 'file:'
        ? appUrl.protocol === 'file:' && next.pathname === appUrl.pathname
        : next.origin === appUrl.origin;
    if (isApp) return;
    e.preventDefault();
    void openWebUrl(target);
  });

  mainWindow.on('focus', () => isFocused = true);
  mainWindow.on('blur', () => isFocused = false);

  // Handle .jnp files on mac
  app.on('open-file', (e: any, filePath: string) => {
    console.info('Loading .jnp file:', filePath);
    if (filePath.endsWith('.jnp')) {
      e.preventDefault();
      // Send to renderer to handle the file import
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('file-dropped', [filePath]);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  // removed because paypal window won't open
  // mainWindow.webContents.on('new-window', (event, url) => {
  //   event.preventDefault();
  //   shell.openExternal(url);
  // });
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  //if (process.platform !== 'darwin') {
  app.quit();
  //  }
});

app
  .whenReady()
  .then(() => {
    if (!hasInstanceLock) return;
    console.info('App ready to launch');

    app.once('before-quit', () => {
      stopMcBridgeServer();
      void import('./src/ai/AiService').then(({ closeAiService }) => closeAiService());
    });

    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) void createWindow();
      else backgroundMode?.show();
    });
  })
  .catch(console.info);

// Popups would inherit the privileged preload: open web links in the user's
// browser instead, and never allow <webview>.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void openWebUrl(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
