import {
  IpcRendererEvent,
  contextBridge,
  ipcRenderer,
  webUtils,
} from 'electron';
import {
  Address,
  BACKEND,
  BroadcastTarget,
  EndpointTransport,
  Messenger,
  TransportFrame,
  workerBotAddress,
  workerScriptAddress,
} from '../common/messaging';
import type {
  IpcActionArgs,
  IpcActionName,
  IpcActionResult,
} from '../common/ipcEvents';
import type { ProfilePublication } from '../common/messaging';
import { PROFILE_ACTIONS } from '../common/profileActions';
import { llmRequestOptions } from '../common/llm';

type Event = (event: IpcRendererEvent, ...args: any[]) => void;

type RendererListener = (...args: any[]) => void;

interface IpcBridge {
  send: (channel: string, ...args: any[]) => void;
  invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>;
  on: (channel: string, func: RendererListener) => (() => void) | undefined;
  once: (channel: string, func: RendererListener) => (() => void) | undefined;
  removeAllListeners: (channel: string) => void;
  removeListener: (channel: string, func: (...args: any[]) => void) => void;
  action: <Name extends IpcActionName>(
    event: Name,
    ...args: IpcActionArgs<Name>
  ) => void;
  get: <Name extends IpcActionName>(
    channel: Name,
    ...args: IpcActionArgs<Name>
  ) => Promise<IpcActionResult<Name>>;
  getPathForFile: (file: File) => string;
}

const listenerDisposers = new Map<string, Map<RendererListener, () => void>>();
const rendererListeners = new Map<string, Set<RendererListener>>();

function registerListener(
  channel: string,
  func: RendererListener,
  once: boolean,
): (() => void) | undefined {
  if (!channel?.length) return;
  let active = true;
  const ipcCallback: Event = (_event: IpcRendererEvent, ...args: any[]) => {
    if (once) dispose();
    func(...args);
  };
  ipcRenderer.on(channel, ipcCallback);
  const local = rendererListeners.get(channel) ?? new Set<RendererListener>();
  local.add(func);
  rendererListeners.set(channel, local);
  const disposeMessenger = rendererMessenger.sub(
    channel,
    { broadcast: 'clients' },
    (data) => {
      if (once) dispose();
      func(data);
    },
  );
  const dispose = () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(channel, ipcCallback);
    disposeMessenger();
    listenerDisposers.get(channel)?.delete(func);
    rendererListeners.get(channel)?.delete(func);
  };
  const listeners =
    listenerDisposers.get(channel) ?? new Map<RendererListener, () => void>();
  listeners.set(func, dispose);
  listenerDisposers.set(channel, listeners);
  return dispose;
}

const ipcBridge: IpcBridge = {
  send(channel: string, ...args: any[]) {
    ipcRenderer.send(channel, ...args);
  },
  invoke<T = any>(channel: string, ...args: any[]) {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },
  on(channel: string, func: RendererListener) {
    return registerListener(channel, func, false);
  },
  once(channel: string, func: RendererListener) {
    return registerListener(channel, func, true);
  },
  removeAllListeners(channel: string) {
    for (const dispose of listenerDisposers.get(channel)?.values() ?? [])
      dispose();
    listenerDisposers.delete(channel);
    ipcRenderer.removeAllListeners(channel);
  },
  removeListener(channel: string, func: (...args: any[]) => void) {
    listenerDisposers.get(channel)?.get(func)?.();
    ipcRenderer.removeListener(channel, func as unknown as any);
  },
  action<Name extends IpcActionName>(
    event: Name,
    ...args: IpcActionArgs<Name>
  ) {
    if (PROFILE_ACTIONS.has(event)) {
      // A component can mount before SocketHandler has completed the initial
      // profile subscription. Never turn that race into an unscoped backend
      // action: wait for the current local watch instead.
      void rendererMessenger
        .profileActionForCurrentProfile(event, args[0])
        .catch((error) => console.warn(`Skipped ${event}:`, error));
      return;
    }
    rendererMessenger.send('client:action', BACKEND, { event, data: args[0] });
  },
  get<Name extends IpcActionName>(channel: Name, ...args: IpcActionArgs<Name>) {
    if (PROFILE_ACTIONS.has(channel)) {
      return rendererMessenger.profileRequestForCurrentProfile<IpcActionResult<Name>>(
        channel,
        args[0],
      );
    }
    return rendererMessenger.request<IpcActionResult<Name>>(
      'client:action',
      BACKEND,
      {
        event: channel,
        data: args[0],
      },
      llmRequestOptions(channel),
    );
  },
  // Electron removed `File.path` in v32+; the renderer must resolve a dropped
  // file's absolute path through webUtils. Returns '' if it can't be resolved.
  getPathForFile(file: File) {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
};

class ElectronRendererTransport implements EndpointTransport {
  private readonly receivers = new Set<(frame: TransportFrame) => void>();

  constructor() {
    ipcRenderer.on('messenger:frame', (_event, frame: TransportFrame) => {
      for (const receiver of this.receivers) receiver(frame);
    });
  }

  send(frame: TransportFrame) {
    ipcRenderer.send('messenger:frame', frame);
  }

  async sendAsync(frame: TransportFrame) {
    this.send(frame);
  }

  subscribe(receiver: (frame: TransportFrame) => void) {
    this.receivers.add(receiver);
    return () => this.receivers.delete(receiver);
  }
}

class RendererMessenger extends Messenger {
  private disposeWatchedProfile?: () => void;
  watchedProfileId?: number;
  private watchedProfileReady?: Promise<number>;
  private resolveInitialProfile?: (profileId: number) => void;
  private readonly initialProfileReady = new Promise<number>((resolve) => {
    this.resolveInitialProfile = resolve;
  });
  private watchSequence = 0;
  sendToBackend(event: string, data?: unknown) {
    this.send(event, BACKEND, data);
  }

  sendToScript(
    profileId: number,
    scriptId: number,
    event: string,
    data?: unknown,
  ) {
    this.send(event, workerScriptAddress(profileId, scriptId), data);
  }

  sendToBot(
    profileId: number,
    scriptId: number,
    botId: number,
    event: string,
    data?: unknown,
  ) {
    this.send(event, workerBotAddress(profileId, scriptId, botId), data);
  }

  async watchProfile(
    profileKey: string,
    handler: (publication: ProfilePublication) => unknown,
  ) {
    const sequence = ++this.watchSequence;
    // A client watches exactly one profile. Drop the old scoped subscription
    // before enabling the new one so an in-flight old-profile publication
    // cannot update this window during the switch.
    this.disposeWatchedProfile?.();
    this.disposeWatchedProfile = undefined;
    this.watchedProfileId = undefined;
    const enabledPromise = this.request<{
      profileId: number;
      profileKey: string;
    }>('profile:enable', BACKEND, { profileKey });
    // Keep an explicit readiness promise so profile-only actions fired during
    // startup stay scoped to this watch instead of going through client:action.
    this.watchedProfileReady = enabledPromise.then((enabled) => enabled.profileId);
    const enabled = await enabledPromise;
    const dispose = this.subscribeProfile(enabled.profileId, (publication) => {
      handler(publication);
      for (const listener of rendererListeners.get(publication.event) ?? [])
        listener(publication.data);
    });
    const snapshot = await this.request(
      'profile:snapshot',
      BACKEND,
      { profileId: enabled.profileId },
    );
    if (sequence !== this.watchSequence) {
      dispose();
      return snapshot;
    }
    this.disposeWatchedProfile = dispose;
    this.watchedProfileId = enabled.profileId;
    this.resolveInitialProfile?.(enabled.profileId);
    this.resolveInitialProfile = undefined;
    return snapshot;
  }

  private async currentProfileId(): Promise<number> {
    if (this.watchedProfileId !== undefined) return this.watchedProfileId;
    return this.watchedProfileReady ?? this.initialProfileReady;
  }

  async profileActionForCurrentProfile(event: string, data?: unknown) {
    this.profileAction(await this.currentProfileId(), event, data);
  }

  async profileRequestForCurrentProfile<T = unknown>(
    event: string,
    data?: unknown,
  ) {
    return this.profileRequest<T>(await this.currentProfileId(), event, data);
  }

  profileAction(profileId: number, event: string, data?: unknown) {
    this.send('client:profile-action', BACKEND, { profileId, event, data });
  }

  profileRequest<T = unknown>(profileId: number, event: string, data?: unknown) {
    return this.request<T>(
      'client:profile-action',
      BACKEND,
      { profileId, event, data },
      llmRequestOptions(event),
    );
  }
}

const rendererAddress = ipcRenderer.sendSync('messenger:connect') as Address;
const rendererMessenger = new RendererMessenger(
  rendererAddress,
  new ElectronRendererTransport(),
);
const messengerBridge = {
  address: rendererAddress,
  send: (event: string, id: Address, data?: unknown) =>
    rendererMessenger.send(event, id, data),
  sendAsync: (event: string, id: Address, data?: unknown) =>
    rendererMessenger.sendAsync(event, id, data),
  request: <T = unknown>(event: string, id: Address, data?: unknown) =>
    rendererMessenger.request<T>(event, id, data),
  pub: (event: string, id: Address | BroadcastTarget, data?: unknown) =>
    rendererMessenger.pub(event, id, data),
  sub: (
    event: string,
    id: Address | BroadcastTarget,
    handler: (data: unknown, context: unknown) => unknown,
    options?: unknown,
  ) => rendererMessenger.sub(event, id, handler, options),
  sendToBackend: (event: string, data?: unknown) =>
    rendererMessenger.sendToBackend(event, data),
  sendToScript: (
    profileId: number,
    scriptId: number,
    event: string,
    data?: unknown,
  ) => rendererMessenger.sendToScript(profileId, scriptId, event, data),
  sendToBot: (
    profileId: number,
    scriptId: number,
    botId: number,
    event: string,
    data?: unknown,
  ) => rendererMessenger.sendToBot(profileId, scriptId, botId, event, data),
  action: (event: string, data?: unknown) =>
    rendererMessenger.send('client:action', BACKEND, { event, data }),
  get: <T = unknown>(event: string, data?: unknown) =>
    rendererMessenger.request<T>('client:action', BACKEND, { event, data }),
  watchProfile: (
    profileKey: string,
    handler: (publication: ProfilePublication) => unknown,
  ) => rendererMessenger.watchProfile(profileKey, handler),
  profileAction: (profileId: number, event: string, data?: unknown) =>
    rendererMessenger.profileAction(profileId, event, data),
  profileRequest: <T = unknown>(
    profileId: number,
    event: string,
    data?: unknown,
  ) => rendererMessenger.profileRequest<T>(profileId, event, data),
};

contextBridge.exposeInMainWorld('ipcRenderer', ipcBridge);
contextBridge.exposeInMainWorld('messenger', messengerBridge);

contextBridge.exposeInMainWorld('platform', process.platform);
