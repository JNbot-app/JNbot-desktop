import { NotificationInstance } from 'antd/es/notification/interface';
import WebRTC_client from '../../../common/WebRTC_client';
import {
  Address,
  BACKEND,
  EndpointTransport,
  Messenger,
  TransportFrame,
  ProfilePublication,
  workerBotAddress,
  workerScriptAddress,
} from '../../../common/messaging';
import { PROFILE_ACTIONS } from '../../../common/profileActions';
import { llmRequestOptions } from '../../../common/llm';

class PeerMessengerTransport implements EndpointTransport {
  private readonly receivers = new Set<(frame: TransportFrame) => void>();

  constructor(private readonly webRTC: WebRTC_client) {
    webRTC.on('messenger:frame', (frame: TransportFrame) => {
      for (const receiver of this.receivers) receiver(frame);
    });
  }

  send(frame: TransportFrame): void {
    this.webRTC.send('messenger:frame', frame);
  }

  async sendAsync(frame: TransportFrame): Promise<void> {
    this.send(frame);
  }

  subscribe(receiver: (frame: TransportFrame) => void): () => void {
    this.receivers.add(receiver);
    return () => this.receivers.delete(receiver);
  }
}

function reportRemoteError(error: unknown): void {
  const detail = {
    code:
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'REMOTE_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
  window.dispatchEvent(new CustomEvent('jnbot:remote-error', { detail }));
}

function exposePeerMessenger(
  address: Address,
  messenger: Messenger,
  onProfileEnabled: (profileId: number) => void,
  dispatchProfileEvent: (event: string, data: unknown) => void,
) {
  let disposeWatchedProfile: (() => void) | undefined;
  const peerMessenger: Window['messenger'] = {
    address,
    send: (event, id, data) => messenger.send(event, id, data),
    sendAsync: (event, id, data) => messenger.sendAsync(event, id, data),
    request: (event, id, data) => messenger.request(event, id, data),
    pub: (event, id, data) => messenger.pub(event, id, data),
    sub: (event, id, handler) => messenger.sub(event, id, handler),
    sendToBackend: (event, data) => messenger.send(event, BACKEND, data),
    sendToScript: (profileId, scriptId, event, data) =>
      messenger.send(event, workerScriptAddress(profileId, scriptId), data),
    sendToBot: (profileId, scriptId, botId, event, data) =>
      messenger.send(event, workerBotAddress(profileId, scriptId, botId), data),
    action: (event, data) => {
      void messenger
        .request('client:action', BACKEND, { event, data })
        .catch(reportRemoteError);
    },
    get: (event, data) =>
      messenger.request('client:action', BACKEND, { event, data }, llmRequestOptions(event)),
    watchProfile: async (profileKey, handler) => {
      disposeWatchedProfile?.();
      disposeWatchedProfile = undefined;
      const enabled = await messenger.request<{
        profileId: number;
        profileKey: string;
      }>('profile:enable', BACKEND, { profileKey });
      const dispose = messenger.subscribeProfile(
        enabled.profileId,
        (data) => {
          const publication = data as ProfilePublication;
          handler(publication);
          dispatchProfileEvent(publication.event, publication.data);
        },
      );
      const snapshot = await messenger.request('profile:snapshot', BACKEND, {
        profileId: enabled.profileId,
      });
      disposeWatchedProfile = dispose;
      onProfileEnabled(enabled.profileId);
      return snapshot;
    },
    profileAction: (profileId, event, data) => {
      void messenger
        .request('client:profile-action', BACKEND, {
          profileId,
          event,
          data,
        })
        .catch(reportRemoteError);
    },
    profileRequest: <T = unknown>(profileId: number, event: string, data?: unknown) =>
      messenger.request<T>(
        'client:profile-action',
        BACKEND,
        { profileId, event, data },
        llmRequestOptions(event),
      ),
  };
  messenger.sub('remote:bootstrap', address, (data) => {
    window.dispatchEvent(new CustomEvent('jnbot:remote-bootstrap', { detail: data }));
  });
  messenger.sub('permissions:updated', address, () => {
    window.dispatchEvent(new Event('jnbot:permissions-updated'));
  });
  messenger.sub('remote:stats', address, (data) => {
    window.dispatchEvent(new CustomEvent('jnbot:remote-stats', { detail: data }));
  });
  // The peer bundle and Electron preload contribute separate Window
  // declarations; the bridge has the same runtime shape in both contexts.
  (window as any).messenger = peerMessenger;
}

class PeerSocket {
  private webRTC!: WebRTC_client;
  private uid: string | null = null;
  private deviceId: string | null = null;
  private password: string | null = null;
  private snackbar?: NotificationInstance;
  private setUIStatus?: (state: string) => void;
  public disconnected = true;
  private messenger?: Messenger;
  private watchedProfileId?: number;
  private readonly messengerListeners = new Map<
    string,
    Map<(...args: any[]) => void, (() => void) | null>
  >();

  constructor() {}

  async login() {
    const params = new URLSearchParams(window.location.search);

    this.uid = params.get('room');

    // get password
    this.password = params.get('token');
    // get deviceId
    this.deviceId = params.get('id');

    this.uid ??= window.localStorage.getItem('roomId');

    this.password ??= window.localStorage.getItem('roomPass');
    this.deviceId ??= window.localStorage.getItem('deviceToken');
    if (!this.uid) this.uid = prompt('Enter room id');
    if (!this.deviceId) this.deviceId = prompt('Enter device id');
    if (!this.password) this.password = prompt('Enter device token');

    if (!this.password || !this.deviceId || !this.uid) return false;
    window.localStorage.setItem('roomId', this.uid);
    window.localStorage.setItem('roomPass', this.password);
    window.localStorage.setItem('deviceToken', this.deviceId);
    return true;
  }

  async connect() {
    this.disconnected = false;
    this.login();
    if (!this.uid || !this.deviceId || !this.password)
      return console.error('Missing uid, deviceId or password');

    if (this.webRTC) {
      console.log('Terminating existing connection...');
      this.webRTC.stop();
    }
    this.webRTC = await WebRTC_client.getInstance(
      this.uid,
      this.deviceId,
      this.password,
    );
    this.webRTC.on('messenger:assigned', (address: Address) => {
      this.messenger = new Messenger(
        address,
        new PeerMessengerTransport(this.webRTC),
      );
      exposePeerMessenger(
        address,
        this.messenger,
        (profileId) => {
          this.watchedProfileId = profileId;
        },
        (event, data) => {
          for (const callback of this.messengerListeners.get(event)?.keys() ?? [])
            callback(data);
        },
      );
      for (const [event, callbacks] of this.messengerListeners) {
        for (const callback of callbacks.keys())
          this.attachMessengerListener(event, callback);
      }
    });

    this.webRTC.on('peer:error', (error) => {
      console.log('Peer error', error);
      if (error.error) error = error.error;
      this.snackbar?.error({
        message: error,
      });
      this.setUIStatus?.('Connection error');

      if (typeof error !== 'object' || error === null) {
        this.disconnected = true;
        return;
      }
      if ('retry' in error && typeof error.retry === 'boolean') {
        this.disconnected = !error.retry;
      }
    });
    this.webRTC.on('peer:disconnected', () => {
      this.setUIStatus?.('Disconnected');
      if (!this.disconnected) {
        this.snackbar?.warning({
          message: 'Peer disconnected. Reconnecting...',
        });
        this.webRTC.reconnect();
      }
    });

    this.webRTC.on('peer:answer_sent', () =>
      this.setUIStatus?.('Waiting for peer to connect...'),
    );
    this.webRTC.on('peer:joining_room', () =>
      this.setUIStatus?.('Joining room...'),
    );

    this.webRTC.on('peer:connected', () => {
      console.log('Peer connected ');
      this.setUIStatus?.('connected');
      this.snackbar?.success({ message: 'Peer successfully connected ' });
    });
    console.log('Creating webRTC connection....');

    await this.webRTC.connect();
    await this.webRTC.enableWebRTC();
    console.log('Connected?');
  }

  public emit(event: string, data?: any) {
    if (!this.webRTC.isConnected)
      return console.error('Cannot emit because not connected');
    this.webRTC.send(event, [data]);
  }

  public on(event: string, callback: (...args: any[]) => void): Function {
    this.webRTC.on(event, callback);
    const callbacks = this.messengerListeners.get(event) ?? new Map();
    callbacks.set(callback, null);
    this.messengerListeners.set(event, callbacks);
    this.attachMessengerListener(event, callback);
    return () => this.removeListener(event, callback);
  }

  public once(event: string, callback: (...args: any[]) => void): Function {
    const wrapped = (...args: any[]) => {
      this.removeListener(event, wrapped);
      callback(...args);
    };
    return this.on(event, wrapped);
  }

  public send(event: string, data: any) {
    if (this.messenger) {
      void this.messenger
        .request('client:send', BACKEND, { channel: event, data })
        .catch(reportRemoteError);
      return;
    }
    this.webRTC.send('send', [event, data]);
  }

  public action(action: string, data?: any) {
    if (this.messenger) {
      if (PROFILE_ACTIONS.has(action)) {
        if (!this.watchedProfileId) {
          reportRemoteError(new Error('No profile is selected.'));
          return;
        }
        void this.messenger
          .request('client:profile-action', BACKEND, {
            profileId: this.watchedProfileId,
            event: action,
            data,
          })
          .catch(reportRemoteError);
        return;
      }
      void this.messenger
        .request('client:action', BACKEND, { event: action, data })
        .catch(reportRemoteError);
      return;
    }
    this.webRTC.send('action', [action, data]);
  }

  async get(event: string, data?: any) {
    if (this.messenger) {
      if (PROFILE_ACTIONS.has(event)) {
        if (!this.watchedProfileId) throw new Error('No profile is selected.');
        return this.messenger.request(
          'client:profile-action',
          BACKEND,
          { profileId: this.watchedProfileId, event, data },
          llmRequestOptions(event),
        );
      }
      return this.messenger.request('client:action', BACKEND, { event, data }, llmRequestOptions(event));
    }
    return this.sendWithAck('get', [event, data]);
  }

  async invoke(event: string, data?: any) {
    if (this.messenger) {
      return this.messenger.request('client:invoke', BACKEND, {
        channel: event,
        data,
      });
    }
    return this.sendWithAck('invoke', [event, data]);
  }

  private sendWithAck(event: string, data: any[]) {
    return new Promise((resolve, reject) => {
      const id = event + Math.random().toString();
      const timeout = window.setTimeout(() => {
        reject(new Error(`${event} request timed out`));
      }, 30_000);
      this.webRTC.once(id, (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      });
      this.webRTC.send(event, [...data, id]);
    });
  }

  removeAllListeners(event: string) {
    for (const callback of this.messengerListeners.get(event)?.keys() ?? []) {
      this.removeListener(event, callback);
    }
    this.messengerListeners.delete(event);
    this.webRTC.removeAllListeners(event);
  }

  removeListener(event: string, callback: (...args: any[]) => void) {
    this.messengerListeners.get(event)?.get(callback)?.();
    this.messengerListeners.get(event)?.delete(callback);
    this.webRTC.removeListener(event, callback);
  }

  public disconnect() {
    console.log('Peersocket disconnect called');
    this.webRTC.stop();
  }

  private attachMessengerListener(
    event: string,
    callback: (...args: any[]) => void,
  ) {
    // Legacy ipcRenderer events are not remote Messenger subscriptions.
    // Remote state arrives through the scoped bootstrap and profile channels.
    void event;
    void callback;
  }

  get hasValidCredentials() {
    return this.uid && this.deviceId && this.password && true;
  }

  setSnackbar(snackbar: NotificationInstance) {
    this.snackbar = snackbar;
  }

  setLoadingScreen(setLoadingScreen: (state: string) => void) {
    this.setUIStatus = setLoadingScreen;
  }
}

export default PeerSocket;
