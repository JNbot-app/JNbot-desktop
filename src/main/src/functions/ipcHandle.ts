import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { Origin } from '../types';

type HandleListener = (
  event: IpcMainInvokeEvent | Origin,
  ...args: any[]
) => any;

const handlers = new Map<string, HandleListener>();

/**
 * Drop-in replacement for `ipcMain.handle` that ALSO records the handler in a
 * registry so remote clients (p2p today, websocket later — anything
 * implementing the `Socket` interface) can invoke it through the socket bridge
 * in `ClientEvents.registerSocket`.
 *
 * `ipcMain.handle` only wires the handler to the local renderer's
 * `ipcRenderer.invoke`; remote transports never reach it, so every
 * `.invoke(channel, …)` from a web/p2p client used to hit a dead stub. Routing
 * registration through this wrapper keeps a single source of truth and is
 * transport-agnostic — a new transport only has to call `invokeHandler` from
 * its bridge. This is the `invoke` counterpart to the `ipcMain.on` → socket
 * `send` bridge (see [[project-ipc-cross-transport]]).
 */
export function handle(channel: string, listener: HandleListener) {
  handlers.set(channel, listener);
  ipcMain.handle(channel, listener as any);
}

/**
 * Dispatch a registered `handle` to a remote client. The `origin` mirrors
 * Electron's `IpcMainInvokeEvent` (carries `reply`/`sockets`), so handlers see
 * the same `(event, ...args)` shape regardless of transport.
 */
export async function invokeHandler(
  channel: string,
  origin: Origin,
  data?: any,
): Promise<any> {
  const listener = handlers.get(channel);
  if (!listener) {
    console.error('No invoke handler registered for channel:', channel);
    return undefined;
  }
  return listener(origin, data);
}
