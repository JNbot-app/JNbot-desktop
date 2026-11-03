import { app, ipcMain, type BrowserWindow } from 'electron';
import path from 'path';
import { parseShareId } from '../common/share';

let pending: string | null = null;

const findLink = (argv: string[]) =>
  argv.find((arg) => arg.startsWith('jnbot://share/'));

/**
 * Registers the `jnbot://` protocol. A share link only marks itself pending
 * and pings the renderer, which pulls it with `share-link-pending`; that way a
 * link that arrives before the UI has mounted is not lost.
 * Returns the handler for links passed to a second instance (Windows/Linux).
 */
export function registerShareDeepLinks(
  getWindow: () => BrowserWindow | null,
  show: () => void,
): (argv: string[]) => void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('jnbot', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient('jnbot');
  }

  const open = (url?: string) => {
    const id = url?.startsWith('jnbot://share/') ? parseShareId(url) : null;
    if (!id) return;
    pending = id;
    show();
    getWindow()?.webContents.send('share-link');
  };

  ipcMain.handle('share-link-pending', () => {
    const id = pending;
    pending = null;
    return id;
  });
  // macOS delivers links through open-url, also on cold start.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    open(url);
  });
  open(findLink(process.argv));
  return (argv) => open(findLink(argv));
}
