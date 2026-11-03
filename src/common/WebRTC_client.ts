import {
  ClientEventData,
  ClientEvents,
  ServerEvents,
} from './SocketEvents';
import WebRTC_base from './WebRTC_base';
import { turnServers } from './buildSecrets';
import jsonPackage from '../../release/app/package.json';

// We allow non-relay candidates as a fallback when relay-only fails. This is
// important for Firefox, which can be slow or unable to negotiate TURN paths
// when the network is friendly enough that host/srflx candidates work fine.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'stun:stun1.l.google.com:19302' },
  ...turnServers([
    'turn:standard.relay.metered.ca:80',
    'turn:standard.relay.metered.ca:80?transport=tcp',
    'turn:standard.relay.metered.ca:443',
    'turns:standard.relay.metered.ca:443?transport=tcp',
  ]),
];

const CONNECTION_TIMEOUT_MS = 30_000;

type ClientState = 'idle' | 'joining' | 'negotiating' | 'connected' | 'closing';

class WebRTC_client extends WebRTC_base {
  private static instance: WebRTC_client | null = null;

  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private state: ClientState = 'idle';
  private remoteDescriptionSet = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private connectWatchdog: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    roomId: string,
    public deviceId: string,
    public password: string,
  ) {
    super(deviceId, false);
    this.roomId = roomId;

    this.on('socket:connected', () => this.startNegotiation());
    this.on('socket:reconnected', () => this.startNegotiation());
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  public override get isConnected(): boolean {
    return (
      this.state === 'connected' &&
      this.pc?.connectionState === 'connected' &&
      this.channel?.readyState === 'open'
    );
  }

  public override async enableWebRTC(): Promise<void> {
    if (this.state !== 'idle') {
      // Already in progress / connected — nothing to do.
      return;
    }
    this.startNegotiation();
  }

  public override send(event: string, data?: any): void {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify([event, data]));
    }
  }

  public override disconnect(): void {
    if (this.state === 'idle') return;
    this.state = 'closing';

    if (this.connectWatchdog) {
      clearTimeout(this.connectWatchdog);
      this.connectWatchdog = null;
    }

    try { this.channel?.close(); } catch { /* idempotent */ }
    try { this.pc?.close(); } catch { /* idempotent */ }

    this.channel = null;
    this.pc = null;
    this.remoteDescriptionSet = false;
    this.pendingCandidates = [];
    this.state = 'idle';
    this.emit('peer:close');
  }

  // ── Signaling listeners ────────────────────────────────────────────────────

  protected override setupListeners(): void {
    super.setupListeners();

    this.socket.off(ClientEvents.ROOM_CLOSED);
    this.socket.on(ClientEvents.ROOM_CLOSED, (data: ClientEventData[ClientEvents.ROOM_CLOSED]) => {
      this.emit('peer:error', {
        error: `Room closed: ${data.reason}`,
        retry: true,
        code: 'ROOM_CLOSED',
      });
    });

    this.socket.off(ClientEvents.OFFER);
    this.socket.on(ClientEvents.OFFER, (data: ClientEventData[ClientEvents.OFFER], cb: Function) => {
      this.handleOffer(data, cb).catch((err) => {
        console.warn('[client] offer handling failed', err);
        try { cb({ error: String(err), retry: true }); } catch { /* cb already used */ }
        this.fail('OFFER_FAILED');
      });
    });

    this.socket.off(ClientEvents.ICE_CANDIDATE);
    this.socket.on(
      ClientEvents.ICE_CANDIDATE,
      (payload: ClientEventData[ClientEvents.ICE_CANDIDATE]) => {
        this.handleRemoteCandidate(payload).catch((err) =>
          console.warn('[client] remote candidate failed', err),
        );
      },
    );
  }

  private async handleOffer(
    data: ClientEventData[ClientEvents.OFFER],
    cb: Function,
  ): Promise<void> {
    if (!data.accepted) {
      cb({ accepted: true });
      return;
    }

    if (this.state !== 'joining' && this.state !== 'negotiating') {
      console.warn('[client] offer received in unexpected state', this.state);
      cb({ error: 'busy', retry: false });
      return;
    }

    this.state = 'negotiating';

    const pc = this.pc ?? this.createPeerConnection();
    this.pc = pc;

    await pc.setRemoteDescription(JSON.parse(data.offer));
    this.remoteDescriptionSet = true;

    // Trickle ICE: send the answer as soon as we have it; don't wait for ICE
    // gathering. Candidates are exchanged via ICE_CANDIDATE events.
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.socket.emit(ServerEvents.ANSWER, {
      answer: JSON.stringify(pc.localDescription),
      roomId: this.roomId!,
      peerId: this.socket.id!,
      deviceId: this.deviceId,
      password: this.password,
    });
    this.emit('peer:answer_sent');

    await this.drainPendingCandidates();

    cb({ accepted: true });
  }

  private async handleRemoteCandidate(
    payload: ClientEventData[ClientEvents.ICE_CANDIDATE],
  ): Promise<void> {
    if (!this.pc) return;

    // End-of-candidates marker.
    if (!payload.candidate) return;

    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(payload.candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(payload.candidate);
    } catch (err) {
      console.debug('[client] addIceCandidate failed', err);
    }
  }

  private async drainPendingCandidates(): Promise<void> {
    if (!this.pc) return;
    const candidates = this.pendingCandidates.splice(0);
    for (const c of candidates) {
      try { await this.pc.addIceCandidate(c); } catch (err) {
        console.debug('[client] drain candidate failed', err);
      }
    }
  }

  // ── Peer connection setup ─────────────────────────────────────────────────

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = ({ candidate }) => {
      // Forward each candidate as it's gathered, plus a null at the end.
      const init = candidate ? candidate.toJSON() : null;
      this.socket.emit(ServerEvents.ICE_CANDIDATE, {
        peerId: this.socket.id!,
        candidate: init,
      });
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'disconnected' || s === 'closed') {
        if (this.state !== 'closing') {
          this.fail(`CONNECTION_${s.toUpperCase()}`);
        }
      }
    };

    pc.ondatachannel = ({ channel }) => {
      this.channel = channel;
      channel.onopen = () => {
        if (this.connectWatchdog) {
          clearTimeout(this.connectWatchdog);
          this.connectWatchdog = null;
        }
        this.state = 'connected';
        this.emit('peer:connected');
      };
      channel.onerror = (err) => console.warn('[client] data channel error', err);
      channel.onmessage = (e) => this.emitRaw(e.data);
      channel.onclose = () => {
        if (this.state === 'closing') return;
        this.fail('CHANNEL_CLOSED');
      };
    };

    return pc;
  }

  private startNegotiation(): void {
    if (this.stopped) return;
    if (this.state !== 'idle') {
      // Reset & restart — happens on signaling reconnect mid-negotiation.
      this.disconnect();
    }

    this.state = 'joining';
    this.pc = this.createPeerConnection();
    this.remoteDescriptionSet = false;
    this.pendingCandidates = [];

    this.connectWatchdog = setTimeout(() => {
      if (this.state !== 'connected') {
        console.warn('[client] connection watchdog timeout');
        this.fail('WATCHDOG_TIMEOUT');
      }
    }, CONNECTION_TIMEOUT_MS);

    this.socket.emit(ServerEvents.CONNECT_WITH_SERVER, {
      roomId: this.roomId!,
      device: this.deviceId,
      password: this.password,
      peerId: this.socket.id!,
      version: jsonPackage.version,
    });
    this.emit('peer:joining_room');
  }

  private fail(reason: string): void {
    if (this.state === 'closing' || this.state === 'idle') return;
    console.warn('[client] connection failed:', reason);
    this.disconnect();
    this.emit('peer:disconnected', { reason });
  }

  public static async getInstance(
    uid: string,
    deviceId: string,
    password: string,
  ): Promise<WebRTC_client> {
    if (
      !WebRTC_client.instance ||
      WebRTC_client.instance.deviceId !== deviceId ||
      WebRTC_client.instance.roomId !== uid
    ) {
      if (WebRTC_client.instance) WebRTC_client.instance.stop();
      WebRTC_client.instance = new WebRTC_client(uid, deviceId, password);
    }
    return WebRTC_client.instance;
  }
}

export default WebRTC_client;
