import WebRTC_nodejs from '../../../../common/WebRTC_nodejs';
import generateUID from '../../../UID';
import ClientEvents_ from '../ClientEvents';
import { Socket } from './Socket';
import Settings_ from '../Settings';
import { backendMessaging } from '../../messaging';
import type { TransportFrame } from '../../../../common/messaging';
import type { Device } from '../../types';
import { normalizePermissions, type ClientPermissions } from '../../../../common/clientPermissions';
import {
  createClientBootstrap,
  createClientStatsSnapshot,
} from '../../messaging/bootstrap';

const UID = generateUID();
const url = 'https://jnbot-app.netlify.app/';

class PeerConnection implements Socket {
  private webrtc: WebRTC_nodejs;
  public isActive = false;
  public id = UID;
  public url = url;
  private readonly messagingPeers = new Map<
    string,
    ReturnType<typeof backendMessaging.registerRemoteClient>
  >();

  public once: (event: string, cb: (args: any) => void) => void = () => {};
  public off: (event: string, cb: (args: any) => void) => void = () => {};
  public removeAllListeners: (event: string) => void = () => {};
  public removeListener: (event: string, cb: (args: any) => void) => void =
    () => {};

  constructor(
    public settings: Settings_,
    public clientEvents: ClientEvents_,
  ) {
    settings.shared.devices ??= [];
    this.webrtc = WebRTC_nodejs.getInstance(UID, this.settings.shared.devices);
    this.once = this.webrtc.once.bind(this.webrtc);
    this.off = this.webrtc.off.bind(this.webrtc);
    this.removeAllListeners = this.webrtc.removeAllListeners.bind(this.webrtc);
    this.removeListener = this.webrtc.removeListener.bind(this.webrtc);

    this.webrtc.on('peer:error', (error) => {
      console.error('Peer error', error);
    });
    this.settings.stats.on('change', () => {
      for (const peerId of this.messagingPeers.keys()) this.sendStats(peerId);
    });

    // peer:connected payload: { peerId, device }. We re-emit `peer:connection`
    // with `[payload, this]` so downstream handlers (DeviceHandler) get
    // (payload, socket) via the on() unpacker below.
    this.webrtc.on('peer:connected', (payload) => {
      const peerId = payload?.peerId;
      if (typeof peerId === 'string' && !this.messagingPeers.has(peerId)) {
        const registration = backendMessaging.registerRemoteClient(
          (frame) => this.webrtc.send('messenger:frame', frame, peerId),
          {
            kind: 'remote',
            subjectId: payload?.device?.id ?? peerId,
            permissions: normalizePermissions(payload?.device?.permissions),
          },
        );
        this.messagingPeers.set(peerId, registration);
        this.webrtc.send('messenger:assigned', registration.address, peerId);
      }
      this.webrtc.emit('peer:connection', [payload, this]);
    });

    this.webrtc.on(
      'messenger:frame',
      (frame: TransportFrame, peerId?: string) => {
        if (typeof peerId === 'string')
          this.messagingPeers.get(peerId)?.receive(frame);
      },
    );

    this.webrtc.on('peer:disconnected', (payload) => {
      const peerId = payload?.peerId;
      if (typeof peerId === 'string') {
        const registration = this.messagingPeers.get(peerId);
        if (registration) this.clientEvents.instanceTransfer.cancelOrigin(registration.address);
        this.messagingPeers.get(peerId)?.dispose();
        this.messagingPeers.delete(peerId);
      }
      this.webrtc.emit('peer:disconnected:flat', [payload, this]);
    });
  }

  sendBootstrap(peerId: string): void {
    const registration = this.messagingPeers.get(peerId);
    const principal = registration && backendMessaging.principalForAddress(registration.address);
    if (!registration || !principal) return;
    this.webrtc.send('messenger:frame', {
      envelope: {
        version: 1,
        type: 'send',
        event: 'remote:bootstrap',
        from: 0,
        to: registration.address,
        data: createClientBootstrap(this.settings, principal),
      },
    }, peerId);
  }

  sendPermissionsUpdated(peerId: string, permissions?: ClientPermissions): void {
    const registration = this.messagingPeers.get(peerId);
    if (!registration) return;
    if (permissions) {
      backendMessaging.updateRemotePrincipalPermissions(registration.address, permissions);
    }
    this.sendBootstrap(peerId);
    this.webrtc.send('messenger:frame', {
      envelope: {
        version: 1,
        type: 'send',
        event: 'permissions:updated',
        from: 0,
        to: registration.address,
        data: undefined,
      },
    }, peerId);
  }

  private sendStats(peerId: string): void {
    const registration = this.messagingPeers.get(peerId);
    const principal = registration && backendMessaging.principalForAddress(registration.address);
    if (!registration || !principal) return;
    this.webrtc.send('messenger:frame', {
      envelope: {
        version: 1,
        type: 'send',
        event: 'remote:stats',
        from: 0,
        to: registration.address,
        data: createClientStatsSnapshot(this.settings, principal),
      },
    }, peerId);
  }

  /**
   * Data-channel event subscription. Handlers receive (...args, ackFn) where
   * ackFn replies to the specific peer that sent the message.
   */
  public on(event: string, cb: (...args: any) => void): void {
    // Special back-compat aliases for the device lifecycle events.
    const innerEvent =
      event === 'peer:disconnected' ? 'peer:disconnected:flat' : event;

    this.webrtc.on(innerEvent, (d: any, peerId?: string) => {
      let id: string | undefined;
      if (!Array.isArray(d)) {
        d = [d];
      } else {
        id = d[d.length - 1];
        if (d.length > 2) d = [d[0], d[1]];
      }
      cb(...d, (data: any) => {
        if (typeof id === 'string') this.webrtc.send(id, data, peerId);
      });
    });
  }

  public emit(event: string, args: any) {
    // Broadcast to all connected peers.
    this.webrtc?.send(event, args);
  }

  public broadcast(event: string, args: any) {
    // Profile data travels over scoped messenger publications. Do not relay
    // legacy broadcasts to remote clients, since those channels have no
    // authenticated profile scope.
    void event;
    void args;
  }

  async start() {
    if (!this.webrtc) return;
    this.isActive = true;
    await this.webrtc.connect();
  }

  public stop() {
    this.isActive = false;
    this.webrtc?.stop();
    for (const registration of this.messagingPeers.values())
      registration.dispose();
    this.messagingPeers.clear();
  }

  public disconnect() {
    this.isActive = false;
    this.webrtc?.disconnect();
  }

  public closeConnection(id: string) {
    this.webrtc.disconnectDevice(id);
  }

  public setDevices(devices: Device[]) {
    this.webrtc.setDevices(devices);
  }
}

export default PeerConnection;
