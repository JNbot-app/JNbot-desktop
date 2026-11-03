import { BrowserWindow } from 'electron';
import { isWebUrl, openWebUrl } from '../../util';

class WindowHandler_ {
  private readonly v4guardVerifying = new Map<string, NodeJS.Timeout>();
  readonly mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  openExternal(
    url: string,
    options?: {
      target?: 'default' | 'browser' | 'electron';
      name?: string;
    },
  ) {
    if (options?.target !== 'electron') return void openWebUrl(url);
    if (!isWebUrl(url)) return console.warn('Refusing to open URL', url);
    // Remote pages never get the preload: it exposes the full IPC bridge.
    const child = new BrowserWindow({
      parent: this.mainWindow,
      show: false,
      minWidth: 400,
      minHeight: 400,
      alwaysOnTop: false,
      maximizable: false,
      title: options.name || 'JNbot',
      titleBarStyle: 'hidden',
      roundedCorners: true,
    });
    child.loadURL(url);
  }

  public async handleV4Guard(data: { url: string; username: string }) {
    if (this.v4guardVerifying.has(data.username)) return;
    this.v4guardVerifying.set(
      data.username,
      setTimeout(() => {
        this.v4guardVerifying.delete(data.username);
      }, 60_000),
    );

    void openWebUrl(data.url);
  }

  public v4guardCompleteUser(username: string) {
    const timeout = this.v4guardVerifying.get(username);
    if (!timeout) return;
    clearTimeout(timeout);
    this.v4guardVerifying.delete(username);
  }

  sendToAll(event: string, data?: any) {
    if (
      this.mainWindow.isDestroyed() ||
      this.mainWindow.webContents.isDestroyed()
    )
      return;
    this.mainWindow.webContents.send(event, data);
  }
}

export default WindowHandler_;
