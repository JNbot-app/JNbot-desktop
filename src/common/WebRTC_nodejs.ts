import { ClientEventData, ClientEvents, ServerEvents } from './SocketEvents';
import {
  RTCPeerConnection as nodeJSRTCPeerConnection,
  RTCDataChannel as nodeJSRTCDataChannel,
  RTCPeerConnection,
  RTCIceCandidate as WeriftRTCIceCandidate,
} from 'werift';
import WebRTC_base from './WebRTC_base';
import { Device } from '../main/src/types';
import packageJSON from '../../release/app/package.json';
import { REMOTE_PROTOCOL_VERSION } from './remoteProtocol';

const ROOM_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_TIMEOUT_MS = 30_000;

const ICE_SERVERS = [
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

type PeerSession = {
  peerId: string;
  pc: nodeJSRTCPeerConnection;
  channel: nodeJSRTCDataChannel | null;
  device: Device | null;
  remoteDescriptionSet: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  watchdog: ReturnType<typeof setTimeout> | null;
  cleanedUp: boolean;
};

class WebRTC_nodejs extends WebRTC_base {
  private static instance: WebRTC_nodejs;
  private sessions = new Map<string, PeerSession>();
  private roomHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
  public version: string;

  private constructor(
    uid: string,
    public devices: Device[],
  ) {
    super(uid, true);
    this.roomId = uid;
    this.version = packageJSON.version;

    this.on('socket:connected', () => {
      this.createRoom();
      this.startRoomHeartbeat();
    });

    this.on('socket:reconnected', () => {
      // After a signaling reconnect the host needs to re-register its room.
      // In-flight sessions are dropped — peers will retry from their side.
      this.tearDownAllSessions('SIGNALING_RECONNECT');
      this.createRoom();
      this.startRoomHeartbeat();
    });

    this.on('socket:disconnected', () => {
      this.stopRoomHeartbeat();
    });
  }

  // ── Signaling listeners ────────────────────────────────────────────────────

  protected override setupListeners() {
    super.setupListeners();

    this.socket.off(ClientEvents.ROOM_HEARTBEAT_ACK);
    this.socket.on(ClientEvents.ROOM_HEARTBEAT_ACK, () => {
      /* keepalive */
    });

    this.socket.off(ClientEvents.ROOM_CLOSED);
    this.socket.on(
      ClientEvents.ROOM_CLOSED,
      (data: ClientEventData[ClientEvents.ROOM_CLOSED]) => {
        console.info('[host] Room closed by server:', data.reason);
        this.stopRoomHeartbeat();
        this.tearDownAllSessions('ROOM_CLOSED');
      },
    );

    this.socket.off(ClientEvents.CONNECT_REQUEST);
    this.socket.on(
      ClientEvents.CONNECT_REQUEST,
      async (data: ClientEventData[ClientEvents.CONNECT_REQUEST], cb: Function) => {
        try {
          await this.handleConnectRequest(data, cb);
        } catch (err) {
          console.warn('[host] connect request failed', err);
          try {
            cb({ error: String(err), retry: true });
          } catch {
            /* cb already used */
          }
        }
      },
    );

    this.socket.off(ClientEvents.ANSWER);
    this.socket.on(
      ClientEvents.ANSWER,
      async (answer: ClientEventData[ClientEvents.ANSWER], cb: Function) => {
        try {
          await this.handleAnswerEvent(answer, cb);
        } catch (err) {
          console.warn('[host] answer handling failed', err);
          try {
            cb({ error: String(err), retry: false });
          } catch {
            /* cb already used */
          }
        }
      },
    );

    this.socket.off(ClientEvents.ICE_CANDIDATE);
    this.socket.on(
      ClientEvents.ICE_CANDIDATE,
      (payload: ClientEventData[ClientEvents.ICE_CANDIDATE]) => {
        this.handleRemoteCandidate(payload).catch((err) =>
          console.warn('[host] remote candidate failed', err),
        );
      },
    );
  }

  private async handleConnectRequest(
    data: ClientEventData[ClientEvents.CONNECT_REQUEST],
    cb: Function,
  ): Promise<void> {
    const peerId = data.peerId;
    if (!peerId) return cb({ error: 'Missing peerId', retry: false });

    if (this.sessions.has(peerId)) {
      // Stale or duplicate request from the same socket — clean up and retry.
      this.tearDownSession(peerId, 'DUPLICATE_REQUEST');
    }

    const device = this.devices.find(
      (d) => d.id === data.device && d.token === data.password,
    );
    if (!device) return cb({ error: 'Invalid device', retry: false });

    const versionError = this.checkVersion(data.version, data.client?.remoteProtocolVersion);
    if (versionError) return cb(versionError);

    const session = this.createSession(peerId, device);

    try {
      const offer = await session.pc.createOffer();
      await session.pc.setLocalDescription(offer as any);

      this.socket.emit(ServerEvents.OFFER, {
        accepted: true,
        offer: JSON.stringify(session.pc.localDescription),
        peerId,
      });

      cb({ accepted: true });
    } catch (err) {
      this.tearDownSession(peerId, 'OFFER_FAILED');
      throw err;
    }
  }

  private async handleAnswerEvent(
    answer: ClientEventData[ClientEvents.ANSWER],
    cb: Function,
  ): Promise<void> {
    if (!answer.answer || !answer.peerId) {
      return cb({ error: 'Invalid answer', retry: false });
    }

    const session = this.sessions.get(answer.peerId);
    if (!session) {
      console.debug('[host] answer for unknown peer', answer.peerId);
      return cb({ error: 'Unknown peer', retry: false });
    }

    const device = this.devices.find(
      (d) => d.id === answer.deviceId && d.token === answer.password,
    );
    if (!device) {
      this.tearDownSession(answer.peerId, 'INVALID_DEVICE');
      return cb({ error: 'Invalid device', retry: false });
    }

    if (session.pc.signalingState !== 'have-local-offer') {
      console.debug(
        '[host] dropping answer — signaling state',
        session.pc.signalingState,
      );
      return cb({ error: 'Already negotiated', retry: false });
    }

    try {
      await session.pc.setRemoteDescription(JSON.parse(answer.answer));
      session.remoteDescriptionSet = true;
      await this.drainPendingCandidates(session);
      cb({ accepted: true });
    } catch (err) {
      this.tearDownSession(answer.peerId, 'ANSWER_FAILED');
      throw err;
    }
  }

  private async handleRemoteCandidate(
    payload: ClientEventData[ClientEvents.ICE_CANDIDATE],
  ): Promise<void> {
    const session = this.sessions.get(payload.peerId);
    if (!session) return;

    if (!payload.candidate) return; // end-of-candidates marker

    if (!session.remoteDescriptionSet) {
      session.pendingCandidates.push(payload.candidate);
      return;
    }

    await this.addRemoteCandidate(session, payload.candidate);
  }

  private async addRemoteCandidate(
    session: PeerSession,
    init: RTCIceCandidateInit,
  ): Promise<void> {
    if (!init.candidate) return;
    try {
      await session.pc.addIceCandidate(
        new WeriftRTCIceCandidate({
          candidate: init.candidate,
          sdpMid: init.sdpMid ?? undefined,
          sdpMLineIndex: init.sdpMLineIndex ?? undefined,
        }),
      );
    } catch (err) {
      console.debug('[host] addIceCandidate failed', err);
    }
  }

  private async drainPendingCandidates(session: PeerSession): Promise<void> {
    const candidates = session.pendingCandidates.splice(0);
    for (const c of candidates) await this.addRemoteCandidate(session, c);
  }

  // ── Per-peer session lifecycle ─────────────────────────────────────────────

  private createSession(peerId: string, device: Device): PeerSession {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const session: PeerSession = {
      peerId,
      pc,
      channel: null,
      device,
      remoteDescriptionSet: false,
      pendingCandidates: [],
      watchdog: setTimeout(() => {
        if (!session.cleanedUp && !this.isSessionConnected(session)) {
          console.warn('[host] session watchdog timeout', peerId);
          this.tearDownSession(peerId, 'WATCHDOG_TIMEOUT');
        }
      }, SESSION_TIMEOUT_MS),
      cleanedUp: false,
    };
    this.sessions.set(peerId, session);

    pc.onIceCandidate.subscribe((candidate) => {
      if (session.cleanedUp || !candidate) return;
      const init: RTCIceCandidateInit = {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? undefined,
        sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
      };
      this.socket.emit(ServerEvents.ICE_CANDIDATE, { peerId, candidate: init });
    });

    pc.iceGatheringStateChange.subscribe((state) => {
      if (session.cleanedUp) return;
      if (state === 'complete') {
        this.socket.emit(ServerEvents.ICE_CANDIDATE, {
          peerId,
          candidate: null,
        });
      }
    });

    pc.connectionStateChange.subscribe((state) => {
      if (session.cleanedUp) return;
      if (
        state === 'disconnected' ||
        state === 'failed' ||
        state === 'closed'
      ) {
        this.tearDownSession(peerId, `CONNECTION_${state.toUpperCase()}`);
      }
    });

    const dc = pc.createDataChannel('messages', {
      protocol: 'json',
      ordered: true,
    });
    session.channel = dc;

    dc.stateChanged.subscribe((v) => {
      if (session.cleanedUp) return;
      if (v === 'open') {
        if (session.watchdog) {
          clearTimeout(session.watchdog);
          session.watchdog = null;
        }
        // Emit only `peer:connected` ({ peerId, device }). `PeerConnection`
        // bridges it to `peer:connection` with the shape DeviceHandler expects
        // (`[{ peerId, device }, socket]`). A second direct `peer:connection`
        // emit here used to fire the back-compat `[device, socket]` shape too,
        // which made DeviceHandler read `device.device.id` and throw.
        this.emit('peer:connected', { peerId, device: session.device });
      } else if (v === 'closed') {
        this.tearDownSession(peerId, 'CHANNEL_CLOSED');
      }
    });

    dc.error.subscribe((err) => console.warn('[host] data channel error', err));
    dc.message.subscribe((data) => this.dispatchMessage(data, peerId));

    return session;
  }

  private dispatchMessage(raw: unknown, peerId: string): void {
    if (typeof raw !== 'string' || raw.length === 0) return;
    this.emit('__raw', raw, peerId);
    try {
      const d = JSON.parse(raw) as [string, unknown];
      if (!Array.isArray(d) || typeof d[0] !== 'string') return;
      this.emit(d[0], d[1], peerId);
    } catch (err) {
      console.info('[host] failed to parse peer payload', err);
    }
  }

  private isSessionConnected(session: PeerSession): boolean {
    return (
      session.pc.connectionState === 'connected' &&
      session.channel?.readyState === 'open'
    );
  }

  private tearDownSession(peerId: string, reason: string): void {
    const session = this.sessions.get(peerId);
    if (!session || session.cleanedUp) return;
    session.cleanedUp = true;

    if (session.watchdog) {
      clearTimeout(session.watchdog);
      session.watchdog = null;
    }
    try {
      session.channel?.close();
    } catch {
      /* idempotent */
    }
    try {
      session.pc.close();
    } catch {
      /* idempotent */
    }
    this.sessions.delete(peerId);

    if (session.device) {
      this.emit('peer:disconnected', {
        peerId,
        device: session.device,
        reason,
      });
    }
  }

  private tearDownAllSessions(reason: string): void {
    for (const peerId of Array.from(this.sessions.keys())) {
      this.tearDownSession(peerId, reason);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  public override get isConnected(): boolean {
    for (const session of this.sessions.values()) {
      if (this.isSessionConnected(session)) return true;
    }
    return false;
  }

  public override send(event: string, data?: any, peerId?: string): void {
    const payload = JSON.stringify([event, data]);
    if (peerId) {
      const session = this.sessions.get(peerId);
      if (session?.channel?.readyState === 'open')
        session.channel.send(payload);
      return;
    }
    for (const session of this.sessions.values()) {
      if (session.channel?.readyState === 'open') session.channel.send(payload);
    }
  }

  public override disconnect(): void {
    this.tearDownAllSessions('DISCONNECT');
  }

  public disconnectDevice(deviceId: string): void {
    for (const [peerId, session] of Array.from(this.sessions.entries())) {
      if (session.device?.id === deviceId)
        this.tearDownSession(peerId, 'DEVICE_DISCONNECTED');
    }
  }

  public setDevices(devices: Device[]): void {
    this.devices = devices;
  }

  public override stop(): void {
    this.stopRoomHeartbeat();
    super.stop();
  }

  public connectedPeerIds(): string[] {
    const ids: string[] = [];
    for (const [id, s] of this.sessions)
      if (this.isSessionConnected(s)) ids.push(id);
    return ids;
  }

  public async enableWebRTC(): Promise<void> {
    // Host: nothing to set up eagerly — sessions are created per peer in
    // handleConnectRequest. Kept for API compatibility with the base class.
  }

  // ── Versioning / room heartbeat ────────────────────────────────────────────

  private checkVersion(clientVersionStr: string | undefined, protocolVersion?: number): PeerError | null {
    if (protocolVersion !== undefined && protocolVersion !== REMOTE_PROTOCOL_VERSION) {
      return {
        error: 'This remote client uses an incompatible JNbot protocol. Please update JNbot Mobile.',
        retry: false,
        code: 'PROTOCOL_INCOMPATIBLE',
      };
    }
    // Versioned remote clients negotiate compatibility via the stable protocol
    // rather than the desktop application's release number. Older web clients
    // intentionally keep the legacy product-version check below.
    if (protocolVersion !== undefined) return null;
    if (!clientVersionStr) {
      return {
        error: 'Host is outdated, please update JNbot application',
        retry: false,
      };
    }
    const server = this.version.split('.').map(Number);
    const client = clientVersionStr.split('.').map(Number);
    if (server.length !== 3 || client.length !== 3) {
      return { error: 'Something went wrong!', retry: false };
    }
    const [sMaj, sMin] = server;
    const [cMaj, cMin] = client;
    if (cMaj === sMaj && cMin === sMin) return null;
    if (cMaj < sMaj || (cMaj === sMaj && cMin < sMin)) {
      return {
        error: 'Client is outdated. Please send usserwout (discord) a message.',
        retry: false,
      };
    }
    return {
      error: 'Host is outdated, please update JNbot application',
      retry: false,
    };
  }

  private sendRoomHeartbeat(): void {
    if (!this.socket?.connected || !this.roomId) return;
    this.socket.emit(ServerEvents.ROOM_HEARTBEAT, { roomId: this.roomId });
  }

  private startRoomHeartbeat(): void {
    this.stopRoomHeartbeat();
    this.sendRoomHeartbeat();
    this.roomHeartbeatInterval = setInterval(
      () => this.sendRoomHeartbeat(),
      ROOM_HEARTBEAT_INTERVAL_MS,
    );
  }

  private stopRoomHeartbeat(): void {
    if (!this.roomHeartbeatInterval) return;
    clearInterval(this.roomHeartbeatInterval);
    this.roomHeartbeatInterval = null;
  }

  public createRoom(): void {
    this.socket.emit(ServerEvents.CREATE_ROOM, { room: this.uid });
  }

  public static getInstance(uid: string, devices: Device[]): WebRTC_nodejs {
    if (!WebRTC_nodejs.instance) {
      WebRTC_nodejs.instance = new WebRTC_nodejs(uid, devices ?? []);
    }
    return WebRTC_nodejs.instance;
  }
}

type PeerError = { error: string; retry?: boolean; code?: string };

export default WebRTC_nodejs;
