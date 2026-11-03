import { autoUpdater } from 'electron-updater';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import axios from 'axios';
import {
  applyResourcesUpdate,
  downloadResourcesUpdate,
} from './winResourcesUpdate';

const isDevelopment =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

function updater({
  send,
  UPDATE_PATH,
  EXECUTABLE_PATH,
  reload,
  ipcMain,
  allowPrerelease = false,
}: {
  UPDATE_PATH: string;
  EXECUTABLE_PATH: string;
  send: (event: string, data?: any) => void;
  reload: () => void;
  ipcMain: any;
  allowPrerelease?: boolean;
}) {
  if (isDevelopment) return;

  // `updater()` is re-invoked on a 30-minute interval (see main.ts), and
  // `autoUpdater` is a long-lived singleton. Without this, every invocation
  // stacks another copy of each handler below, producing duplicate snackbars /
  // downloads and eventually a MaxListenersExceededWarning. Clear the events we
  // own before re-registering them.
  for (const evt of [
    'checking-for-update',
    'update-available',
    'update-not-available',
    'download-progress',
    'update-downloaded',
    'error',
  ] as const) {
    autoUpdater.removeAllListeners(evt);
  }

  autoUpdater.allowPrerelease = allowPrerelease;

  // On macOS, electron-updater uses Squirrel.Mac/ShipIt which enforces code signature validation.
  // If you distribute unsigned builds, ShipIt will reject the update. We only use electron-updater
  // to check for updates; downloading/installing is handled by our custom macUpdater().
  const isMac = process.platform === 'darwin';
  // On Windows we first try the resources update (see winResourcesUpdate.ts) and
  // only download the full installer when that isn't possible.
  const isWindows = process.platform === 'win32';
  if (isMac || isWindows) {
    autoUpdater.autoDownload = false;
  }

  // With autoDownload, the check result carries a `downloadPromise` that rejects
  // on download failures. Those are already handled by the 'error' listener, so
  // swallow the rejection here; otherwise it reaches the global
  // unhandledRejection handler and gets reported as a crash.
  function checkForUpdates() {
    return autoUpdater.checkForUpdates().then((result) => {
      result?.downloadPromise?.catch(() => {});
    });
  }

  let version: string;
  let triedBetaChannel = false;
  let triedCacheClear = false;
  let resourcesStaged = false;
  let latestUpdateInfo: any | undefined;
  autoUpdater.on('checking-for-update', () => {
    console.info('[JNbot-updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info: any) => {
    version = info.version;
    latestUpdateInfo = info;
    console.info('[JNbot-updater] Update available', info);
    send('snackbar', {
      title: 'Downloading version ' + info.version,
      variant: 'info',
    });

    if (isMac) {
      downloadMacUpdateIfNeeded(latestUpdateInfo)
      .then(waitForUpdateConfirmation)
        .catch((err: unknown) => {
          console.error('[JNbot-updater] mac download/install failed', err);
          error(4, String(err));
        });
    }

    if (isWindows) {
      downloadResourcesUpdate(info.version, (percent) => send_progress(1, percent))
        .catch((err: unknown) => {
          console.warn('[JNbot-updater] Resources update failed, using installer', err);
          return false;
        })
        .then((staged) => {
          resourcesStaged = staged;
          if (staged) {
            send_progress(2, version);
            waitForUpdateConfirmation();
          } else autoUpdater.downloadUpdate().catch(() => {}); // handled by 'error'
        });
    }
  });
  autoUpdater.on('update-not-available', async (info: any) => {
    console.info('Update not available');
    console.info(info);
    if (allowPrerelease && !triedBetaChannel) {
      triedBetaChannel = true;
      autoUpdater.channel = 'beta';
      checkForUpdates()
        .then(() => (autoUpdater.channel = null))
        .catch((err: unknown) => console.error(err));
      return;
    }
  });

  autoUpdater.on('download-progress', (process: any) => {
    console.info('Downloading update...', process);
    send_progress(1, process.percent);
  });


  function waitForUpdateConfirmation(){
    // Replace handlers from earlier (30-minute) updater() runs, which may hold
    // a stale install method.
    ipcMain.removeAllListeners('install-update');
    ipcMain.once('install-update', () => {
      console.info('INSTALLING!');
      send_progress(4, version);

      if (process.platform === 'darwin') macUpdater();
      else if (resourcesStaged) {
        autoUpdater.autoInstallOnAppQuit = false;
        applyResourcesUpdate();
      } else autoUpdater.quitAndInstall();
    });
  }


  autoUpdater.on('update-downloaded', () => {
    console.info('[JNbot-updater]  Update downloaded');
    send_progress(2, version);
    waitForUpdateConfirmation()
  });

  autoUpdater.on('error', (err: unknown) => {
    console.error('[JNbot-updater] error: ', err);

    const message = err instanceof Error ? err.message : String(err);
    console.error('[JNbot-updater] Error detected:', message);

    // Fix voor de "rename ENOENT" (Windows): de gedownloade temp-installer is
    // verdwenen vóór de rename (meestal door antivirus of een corrupte cache).
    // Eén keer de pending-cache wissen en een volledige (non-differential)
    // download opnieuw proberen.
    if (message.includes('ENOENT') || message.includes('rename')) {
      if (!triedCacheClear) {
        triedCacheClear = true;
        console.warn('[JNbot-updater] Update cache corrupt, clearing and retrying...');
        clearPendingCache(message);
        autoUpdater.disableDifferentialDownload = true; // full re-download for the retry only
        checkForUpdates().catch((e: unknown) => console.error(e));
      } else {
        send('snackbar', {
          title: 'Update download failed. Please restart the app.',
          variant: 'error',
        });
      }
      return; // Stop verdere afhandeling
    }

    // When allowPrerelease is enabled, GitHub prereleases are typically published under the "beta" channel
    // (e.g. beta-mac.yml). electron-updater may still start by looking for latest-*.yml.
    // If that 404s, retry once using the beta channel.
    const is404 = /\b404\b/.test(message);
    const mentionsLatestYml = /latest-(mac|linux|win)\.yml/i.test(message);

    if (allowPrerelease && !triedBetaChannel && is404 && mentionsLatestYml) {
      triedBetaChannel = true;
      console.info('[JNbot-updater] Retrying update check on beta channel...');
      autoUpdater.channel = 'beta';
      checkForUpdates().catch((e: unknown) => console.error(e));
    }
  });

  checkForUpdates().catch((err: unknown) => console.error(err));
  //autoUpdater.checkForUpdatesAndNotify();

  async function downloadMacUpdateIfNeeded(info: any | undefined) {
    if (!isMac) return;
    if (!info?.version) throw new Error('No update info available');

    const fileName: string | undefined = info?.path || info?.files?.[0]?.url;
    if (!fileName || typeof fileName !== 'string') {
      throw new Error('Could not determine update file name');
    }

    fs.mkdirSync(UPDATE_PATH, { recursive: true });

    const updateInfoPath = path.join(UPDATE_PATH, 'update-info.json');
    fs.writeFileSync(
      updateInfoPath,
      JSON.stringify({ fileName }, null, 2),
      'utf8',
    );

    const destinationPath = path.join(UPDATE_PATH, fileName);
    if (fs.existsSync(destinationPath)) {
      return;
    }

    const downloadUrl = `https://github.com/usserwout/JNbot-updater/releases/download/v${info.version}/${fileName}`;
    console.info('[JNbot-updater] macUpdater downloading', downloadUrl);

    const response = await axios.get(downloadUrl, { responseType: 'stream' });
    const total = Number(response.headers['content-length'] ?? 0);

    let progress = 0;

    await new Promise<void>((resolve, reject) => {
      let transferred = 0;
      const writer = fs.createWriteStream(destinationPath);
      response.data.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        if (total > 0) {
          let percent = (transferred / total) * 100;
          console.log(`[JNbot-updater] Downloaded ${percent.toFixed(2)}%`);
          if (percent - progress >= 10) {
            send_progress(1, percent);
            progress = percent;
          }
        }
      });
      response.data.on('error', reject);
      writer.on('error', reject);
      writer.on('close', () => resolve());
      response.data.pipe(writer);
    });

    send_progress(2, info.version);
  }

  // Custom updater for mac because I don't wanna sign app
  function macUpdater() {
    if (!fs.existsSync(UPDATE_PATH + '/update-info.json'))
      return console.info(
        '[JNbot-updater]: No update info found: ' +
          UPDATE_PATH +
          '/update-info.json',
      );
    let info;
    try {
      info = JSON.parse(
        fs.readFileSync(UPDATE_PATH + '/update-info.json', 'utf8'),
      );
    } catch (err: any) {
      return error(2, err);
    }
    const filePath = UPDATE_PATH + '/' + info.fileName;
    if (!fs.existsSync(filePath))
      return error(2, '[jnbot-updater]: Update file not found ' + filePath);

    const output = path.join(EXECUTABLE_PATH, '..', '..', '..');
    if (!output.endsWith('JNbot.app'))
      return error(3, '[jnbot-updater]: Invalid path: ' + output);

    os_func('unzip', ['-d', path.join(output, '..'), '-o', filePath])
      .then((res) => {
        console.info('[JNbot-updater] os >>>', res);
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.info(e);
        }
        setTimeout(() => {
          reload();
        }, 2000);
      })
      .catch((err: any) => {
        error(4, err);
      });
  }

  // Derive the corrupt `pending` directory straight from the rename error
  // message and remove it, so a stale/locked cache can't break every retry.
  function clearPendingCache(message: string) {
    const match = message.match(/rename '([^']+)'/);
    if (!match) return;
    const pendingDir = path.dirname(match[1]);
    try {
      fs.rmSync(pendingDir, { recursive: true, force: true });
      console.warn('[JNbot-updater] Cleared update cache:', pendingDir);
    } catch (e) {
      console.error('[JNbot-updater] Failed to clear update cache', e);
    }
  }

  function error(loc: number, err: string) {
    send_progress(
      3,
      'Could not update JNbot. Try to manually reinstall JNbot.',
    );
    console.error(loc, err);
    send('snackbar', {
      title: 'Failed to install (' + loc + ')',
      variant: 'error',
    });
    fs.appendFileSync(
      UPDATE_PATH + '/errorLog.log',
      '[JNbot-updater]: ' + loc + '\n' + err + '\n]',
    );
  }

  // status:
  // 0: No update
  // 1: Download progress: {percent}
  // 2: Ready to install: {version}
  // 3: Error: {error}
  function send_progress(state: number, data: any) {
    console.info('[JNbot-updater]: Sending progress', state, data);
    send('actions', ['update_state', { data, state }]);
  }
}

function os_func(cmd: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(cmd, args, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export default updater;
