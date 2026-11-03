import {
  app,
  autoUpdater,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  Tray,
  type WebContents,
} from 'electron';
import fs from 'fs';
import path from 'path';
import type { ProfileRuntimeSummary } from '../common/profileRuntime';
import { devicePath } from './src/functions/storage/portablePaths';

/** Owns desktop-only preferences and the lifetime of the hidden window. */
export default class DesktopBackgroundMode {
  private enabled = false;

  private quitting = false;

  private tray?: Tray;

  private status = '0 bots · 0 scripts';

  private readonly summaries = new Map<string, ProfileRuntimeSummary>();

  private readonly settingsPath = devicePath('desktop-settings.json');

  constructor(
    private readonly window: BrowserWindow,
    private readonly assetPath: (name: string) => string,
  ) {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const settings: unknown = JSON.parse(
          fs.readFileSync(this.settingsPath, 'utf8'),
        );
        if (
          typeof settings === 'object' &&
          settings !== null &&
          'keepRunningOnClose' in settings &&
          settings.keepRunningOnClose === true
        ) {
          this.createTray();
          this.enabled = true;
        }
      }
    } catch (error) {
      console.error('Could not enable desktop background mode:', error);
    }

    ipcMain.handle('desktop:background:get', (event) => {
      this.checkSender(event.sender);
      return this.enabled;
    });
    ipcMain.handle('desktop:background:set', (event, enabled: unknown) => {
      this.checkSender(event.sender);
      if (typeof enabled !== 'boolean')
        throw new Error('Expected a boolean background preference.');
      this.setEnabled(enabled);
      return this.enabled;
    });
    ipcMain.handle('desktop:show', (event) => {
      this.checkSender(event.sender);
      this.show();
    });

    this.window.on('close', (event) => {
      if (!this.enabled || !this.tray || this.quitting) return;
      event.preventDefault();
      this.window.hide();
    });
    this.window.on('session-end', this.prepareToQuit);
    app.on('before-quit', this.prepareToQuit);
    autoUpdater.on('before-quit-for-update', this.prepareToQuit);
    powerMonitor.on('shutdown', this.prepareToQuit);
    app.once('will-quit', () => {
      this.tray?.destroy();
      ipcMain.removeHandler('desktop:background:get');
      ipcMain.removeHandler('desktop:background:set');
      ipcMain.removeHandler('desktop:show');
    });
  }

  private checkSender(sender: WebContents): void {
    if (sender !== this.window.webContents)
      throw new Error('Desktop settings require the main window.');
  }

  private readonly prepareToQuit = (): void => {
    this.quitting = true;
  };

  show(): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  private setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    if (enabled) this.createTray();
    try {
      fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
      const temporaryPath = `${this.settingsPath}.tmp`;
      fs.writeFileSync(
        temporaryPath,
        JSON.stringify({ keepRunningOnClose: enabled }),
        'utf8',
      );
      fs.renameSync(temporaryPath, this.settingsPath);
    } catch (error) {
      if (enabled) {
        this.tray?.destroy();
        this.tray = undefined;
      }
      throw error;
    }
    this.enabled = enabled;
    if (!enabled) {
      if (!this.window.isVisible()) this.show();
      this.tray?.destroy();
      this.tray = undefined;
    }
  }

  updateSummary(summary: ProfileRuntimeSummary): void {
    const previous = this.summaries.get(summary.profileKey);
    if (previous?.bots === summary.bots && previous.scripts === summary.scripts)
      return;
    this.summaries.set(summary.profileKey, summary);
    let bots = 0;
    let scripts = 0;
    this.summaries.forEach((runtime) => {
      bots += runtime.bots;
      scripts += runtime.scripts;
    });
    const status = `${bots} ${bots === 1 ? 'bot' : 'bots'} · ${scripts} ${scripts === 1 ? 'script' : 'scripts'}`;
    if (status === this.status) return;
    this.status = status;
    this.updateTray();
  }

  private createTray(): void {
    if (this.tray) return;
    let filename = 'icons/32x32.png';
    if (process.platform === 'darwin') filename = 'trayTemplate.png';
    else if (process.platform === 'win32') filename = 'icon.ico';
    const image = nativeImage.createFromPath(this.assetPath(filename));
    if (image.isEmpty()) throw new Error('Could not load the JNbot tray icon.');
    if (process.platform === 'darwin') image.setTemplateImage(true);
    const tray = new Tray(image);
    this.tray = tray;
    try {
      this.updateTray();
      if (process.platform !== 'darwin') tray.on('click', () => this.show());
    } catch (error) {
      tray.destroy();
      this.tray = undefined;
      throw error;
    }
  }

  private updateTray(): void {
    if (!this.tray) return;
    this.tray.setToolTip(`JNbot — ${this.status}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: this.status, enabled: false },
        { type: 'separator' },
        { label: 'Open JNbot', click: () => this.show() },
        { label: 'Quit JNbot', click: () => app.quit() },
      ]),
    );
  }
}
