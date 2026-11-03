import { EventEmitter } from 'node:events';
import net from 'node:net';
import crypto from 'node:crypto';
import io, { type Socket as SignalSocket } from 'socket.io-client';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  type RTCDataChannel,
} from 'werift';
import WebRTC_base from '../../../../common/WebRTC_base';
import { turnServers } from '../../../../common/buildSecrets';
import { ClientType, ServerEvents } from '../../../../common/SocketEvents';
import {
  TUNNEL_CHUNK_BYTES,
  TUNNEL_HIGH_WATER,
  TUNNEL_LOW_WATER,
  TunnelFrameType,
  decodeTunnelFrame,
  encodeTunnelFrame,
} from './tunnelProtocol';
import { secretsEqual } from './invite';

const ICE_SERVERS = [
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  ...turnServers([
    'turn:standard.relay.metered.ca:80',
    'turn:standard.relay.metered.ca:443?transport=tcp',
  ]),
];

const MC_HOST = ClientType.MINECRAFT_HOST;
const MC_CLIENT = ClientType.MINECRAFT_CLIENT;
const CONNECT_TIMEOUT_MS = 30_000;
const MAX_STREAMS = 8;
const MAX_PEERS = 8;
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type Candidate = RTCIceCandidateInit | null;

const toCandidate = (candidate: RTCIceCandidateInit) =>
  new RTCIceCandidate({
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? undefined,
    sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
  });

const makeSignalSocket = (token: string, type: number) =>
  io(WebRTC_base.SIGNAL_SERVER, {
    auth: { token, type, version: WebRTC_base.VERSION },
    secure: true,
    reconnection: true,
    transports: ['websocket'],
  });

function wireBufferedChannel(channel: RTCDataChannel, streams: Map<number, net.Socket>) {
  channel.bufferedAmountLowThreshold = TUNNEL_LOW_WATER;
  channel.bufferedAmountLow.subscribe(() => {
    for (const socket of streams.values()) socket.resume();
  });
}

function sendSocketData(channel: RTCDataChannel, streamId: number, socket: net.Socket) {
  socket.on('data', (chunk: Buffer) => {
    for (let offset = 0; offset < chunk.length; offset += TUNNEL_CHUNK_BYTES) {
      channel.send(
        encodeTunnelFrame(
          TunnelFrameType.DATA,
          streamId,
          chunk.subarray(offset, offset + TUNNEL_CHUNK_BYTES),
        ),
      );
    }
    if (channel.bufferedAmount > TUNNEL_HIGH_WATER) socket.pause();
  });
}

class HostTunnelSession {
  private authenticated = false;
  private readonly streams = new Map<number, net.Socket>();
  private authTimeout?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private lastMessageAt = Date.now();

  constructor(
    private readonly channel: RTCDataChannel,
    private readonly accessKey: string,
    private readonly targetPort: number,
    private readonly onAuthenticated: () => void,
    private readonly onFailure: (message: string) => void,
  ) {
    wireBufferedChannel(channel, this.streams);
    channel.message.subscribe((raw) => this.onMessage(raw));
    channel.stateChanged.subscribe((state) => {
      if (state === 'open') this.startTimers();
      if (state === 'closed') this.close();
    });
  }

  private startTimers() {
    if (!this.authenticated && !this.authTimeout) {
      this.authTimeout = setTimeout(() => {
        this.onFailure('Peer authentication timed out');
        this.channel.close();
      }, 10_000);
      this.authTimeout.unref();
    }
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastMessageAt > 45_000) this.channel.close();
      else if (this.channel.readyState === 'open')
        this.channel.send(encodeTunnelFrame(TunnelFrameType.PING));
    }, 15_000);
    this.heartbeat.unref();
  }

  get isAuthenticated() {
    return this.authenticated;
  }

  private onMessage(raw: unknown) {
    try {
      const frame = decodeTunnelFrame(raw);
      this.lastMessageAt = Date.now();
      if (!this.authenticated) {
        if (
          frame.type !== TunnelFrameType.AUTH ||
          !secretsEqual(this.accessKey, frame.payload.toString('utf8'))
        ) {
          this.onFailure('Peer authentication was rejected');
          this.channel.close();
          return;
        }
        this.authenticated = true;
        clearTimeout(this.authTimeout);
        this.channel.send(encodeTunnelFrame(TunnelFrameType.AUTH_OK));
        this.onAuthenticated();
        return;
      }

      if (frame.type === TunnelFrameType.PING) {
        this.channel.send(encodeTunnelFrame(TunnelFrameType.PONG));
        return;
      }
      if (frame.type === TunnelFrameType.PONG) return;
      if (!frame.streamId) throw new Error('Missing tunnel stream id');

      if (frame.type === TunnelFrameType.OPEN) {
        if (this.streams.size >= MAX_STREAMS || this.streams.has(frame.streamId))
          throw new Error('Too many tunnel streams');
        const socket = net.createConnection({ host: '127.0.0.1', port: this.targetPort });
        this.streams.set(frame.streamId, socket);
        sendSocketData(this.channel, frame.streamId, socket);
        socket.on('end', () => this.send(TunnelFrameType.END, frame.streamId));
        socket.on('error', () => this.send(TunnelFrameType.RESET, frame.streamId));
        socket.on('close', () => this.streams.delete(frame.streamId));
        return;
      }

      const socket = this.streams.get(frame.streamId);
      if (!socket) return;
      if (frame.type === TunnelFrameType.DATA) socket.write(frame.payload);
      if (frame.type === TunnelFrameType.END) socket.end();
      if (frame.type === TunnelFrameType.RESET) socket.destroy();
    } catch (error) {
      this.onFailure(`Invalid tunnel frame: ${messageOf(error)}`);
      this.channel.close();
    }
  }

  private send(type: TunnelFrameType, streamId: number) {
    if (this.channel.readyState === 'open')
      this.channel.send(encodeTunnelFrame(type, streamId));
  }

  close() {
    if (this.authTimeout) clearTimeout(this.authTimeout);
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const socket of this.streams.values()) socket.destroy();
    this.streams.clear();
  }
}

type HostPeer = {
  pc: RTCPeerConnection;
  remoteDescriptionSet: boolean;
  candidates: RTCIceCandidateInit[];
  session?: HostTunnelSession;
  timeout: NodeJS.Timeout;
};

export class MinecraftTunnelHost extends EventEmitter {
  private signal?: SignalSocket;
  private readonly peers = new Map<string, HostPeer>();
  private heartbeat?: NodeJS.Timeout;

  constructor(
    readonly roomId: string,
    private readonly hostKey: string,
    private readonly accessKey: string,
    private readonly targetPort: number,
  ) {
    super();
  }

  get peerCount() {
    return [...this.peers.values()].filter((peer) => peer.session?.isAuthenticated).length;
  }

  private log(message: string) {
    console.info(`[minecraft-tunnel:host] ${message}`);
    this.emit('log', message);
  }

  async start(): Promise<void> {
    if (this.signal?.connected) return;
    const signal = makeSignalSocket(this.hostKey, MC_HOST);
    this.signal = signal;
    this.installSignalHandlers(signal);
    await new Promise<void>((resolve, reject) => {
      let connected = false;
      const timeout = setTimeout(() => {
        signal.disconnect();
        reject(new Error('Signaling connection timed out'));
      }, 30_000);
      signal.on('connect', () => {
        if (this.heartbeat) clearInterval(this.heartbeat);
        signal.emit('CREATE_ROOM', { room: this.roomId, kind: 'minecraft' });
        signal.emit('ROOM_HEARTBEAT', { roomId: this.roomId });
        this.heartbeat = setInterval(
          () => signal.emit('ROOM_HEARTBEAT', { roomId: this.roomId }),
          5 * 60 * 1000,
        );
        this.heartbeat.unref();
        if (!connected) {
          connected = true;
          clearTimeout(timeout);
          resolve();
        }
      });
      signal.once('connect_error', (error) => {
        if (!connected) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  private installSignalHandlers(signal: SignalSocket) {
    signal.off('CONNECT_REQUEST');
    signal.on('CONNECT_REQUEST', async (data: any, ack: Function) => {
      if (data?.kind !== 'minecraft' || typeof data.peerId !== 'string')
        return ack({ error: 'Invalid Minecraft tunnel request', retry: false });
      if (this.peers.size >= MAX_PEERS)
        return ack({ error: 'Minecraft tunnel is full', retry: true });
      try {
        const peer = this.createPeer(data.peerId);
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer as any);
        signal.emit('OFFER', {
          accepted: true,
          offer: JSON.stringify(peer.pc.localDescription),
          peerId: data.peerId,
        });
        ack({ accepted: true });
      } catch (error) {
        this.log(`Failed to create peer offer: ${messageOf(error)}`);
        this.dropPeer(data.peerId);
        ack({ error: String(error), retry: true });
      }
    });
    signal.off('ANSWER');
    signal.on('ANSWER', async (data: any, ack: Function) => {
      const peer = this.peers.get(data?.peerId);
      if (!peer || !data?.answer) return ack({ error: 'Unknown peer', retry: false });
      try {
        await peer.pc.setRemoteDescription(JSON.parse(data.answer));
        peer.remoteDescriptionSet = true;
        for (const candidate of peer.candidates.splice(0))
          await peer.pc.addIceCandidate(toCandidate(candidate));
        ack({ accepted: true });
      } catch (error) {
        this.log(`Failed to apply peer answer: ${messageOf(error)}`);
        this.dropPeer(data.peerId);
        ack({ error: String(error), retry: true });
      }
    });
    signal.off('ICE_CANDIDATE');
    signal.on('ICE_CANDIDATE', async ({ peerId, candidate }: { peerId: string; candidate: Candidate }) => {
      const peer = this.peers.get(peerId);
      if (!peer || !candidate) return;
      if (!peer.remoteDescriptionSet) peer.candidates.push(candidate);
      else await peer.pc.addIceCandidate(toCandidate(candidate)).catch((error) =>
        this.log(`Rejected a remote ICE candidate: ${messageOf(error)}`),
      );
    });
    signal.on('ERROR', (error: any) =>
      this.log(`Signaling error: ${error?.error || error?.message || 'unknown error'}`),
    );
    signal.on('disconnect', () => this.dropAllPeers());
  }

  private createPeer(peerId: string): HostPeer {
    this.dropPeer(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('minecraft-tunnel', { ordered: true });
    const timeout = setTimeout(() => this.dropPeer(peerId), CONNECT_TIMEOUT_MS);
    timeout.unref();
    const session = new HostTunnelSession(
      channel,
      this.accessKey,
      this.targetPort,
      () => {
        this.log('Peer connected');
        this.emit('peers', this.peerCount);
      },
      (message) => this.log(message),
    );
    const peer: HostPeer = {
      pc,
      remoteDescriptionSet: false,
      candidates: [],
      timeout,
      session,
    };
    this.peers.set(peerId, peer);
    channel.stateChanged.subscribe((state) => {
      if (state === 'open') clearTimeout(peer.timeout);
      if (state === 'closed') this.dropPeer(peerId);
    });
    pc.onIceCandidate.subscribe((candidate) => {
      this.signal?.emit('ICE_CANDIDATE', {
        peerId,
        candidate: candidate?.candidate ? candidate : null,
      });
    });
    pc.connectionStateChange.subscribe((state) => {
      if (state === 'failed' || state === 'closed' || state === 'disconnected')
        this.dropPeer(peerId);
    });
    return peer;
  }

  private dropPeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    clearTimeout(peer.timeout);
    peer.session?.close();
    peer.pc.close().catch(() => undefined);
    this.emit('peers', this.peerCount);
  }

  private dropAllPeers() {
    for (const peerId of [...this.peers.keys()]) this.dropPeer(peerId);
  }

  stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.dropAllPeers();
    this.signal?.disconnect();
    this.signal = undefined;
  }
}

export class MinecraftTunnelClient extends EventEmitter {
  private signal?: SignalSocket;
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private listener?: net.Server;
  private readonly streams = new Map<number, net.Socket>();
  private nextStreamId = 1;
  private connection?: Promise<RTCDataChannel>;
  private authResolve?: () => void;
  private disconnecting = false;

  constructor(
    readonly roomId: string,
    private readonly accessKey: string,
    readonly localPort: number,
  ) {
    super();
  }

  private log(message: string, failure = false) {
    console.info(`[minecraft-tunnel:client] ${message}`);
    this.emit('log', message);
    if (failure) this.emit('failure', message);
  }

  async startLocalProxy(): Promise<void> {
    if (this.listener) return;
    const listener = net.createServer((socket) => void this.openLocalStream(socket));
    this.listener = listener;
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(this.localPort, '127.0.0.1', () => {
        listener.off('error', reject);
        this.log(`Local Minecraft proxy listening on 127.0.0.1:${this.localPort}`);
        resolve();
      });
    });
  }

  private async openLocalStream(socket: net.Socket) {
    try {
      const channel = await this.ensureConnected();
      const streamId = this.nextStreamId++ >>> 0 || ++this.nextStreamId;
      if (this.streams.size >= MAX_STREAMS) throw new Error('Too many local connections');
      this.streams.set(streamId, socket);
      channel.send(encodeTunnelFrame(TunnelFrameType.OPEN, streamId));
      sendSocketData(channel, streamId, socket);
      socket.on('end', () => this.send(TunnelFrameType.END, streamId));
      socket.on('error', () => this.send(TunnelFrameType.RESET, streamId));
      socket.on('close', () => this.streams.delete(streamId));
    } catch (error) {
      this.log(`Connection failed: ${messageOf(error)}`, true);
      socket.destroy();
    }
  }

  private ensureConnected(): Promise<RTCDataChannel> {
    if (this.channel?.readyState === 'open') return Promise.resolve(this.channel);
    if (this.connection) return this.connection;
    this.connection = this.connect().finally(() => {
      if (this.channel?.readyState !== 'open') this.connection = undefined;
    });
    return this.connection;
  }

  private async connect(): Promise<RTCDataChannel> {
    const signal = makeSignalSocket(crypto.randomBytes(24).toString('base64url'), MC_CLIENT);
    this.signal = signal;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    let remoteDescriptionSet = false;
    const pending: RTCIceCandidateInit[] = [];
    let rejectConnection: (error: Error) => void = () => undefined;

    pc.connectionStateChange.subscribe((state) => {
      if (state === 'failed') {
        this.log('WebRTC ICE connection failed', true);
        rejectConnection(new Error('WebRTC ICE connection failed'));
      }
    });

    pc.onIceCandidate.subscribe((candidate) => {
      signal.emit('ICE_CANDIDATE', {
        peerId: signal.id,
        candidate: candidate?.candidate ? candidate : null,
      });
    });
    signal.on('ICE_CANDIDATE', async ({ candidate }: { candidate: Candidate }) => {
      if (!candidate) return;
      if (!remoteDescriptionSet) pending.push(candidate);
      else await pc.addIceCandidate(toCandidate(candidate)).catch(() => undefined);
    });

    const channelPromise = new Promise<RTCDataChannel>((resolve, reject) => {
      rejectConnection = reject;
      const timeout = setTimeout(() => reject(new Error('P2P connection timed out')), CONNECT_TIMEOUT_MS);
      pc.onDataChannel.subscribe((channel) => {
        channel.stateChanged.subscribe((state) => {
          if (state === 'closed' && this.channel === channel) {
            this.disconnectPeer();
            return;
          }
          if (state !== 'open') return;
          this.channel = channel;
          wireBufferedChannel(channel, this.streams);
          channel.message.subscribe((raw) => this.onMessage(raw));
          const authTimeout = setTimeout(() => reject(new Error('Tunnel authentication timed out')), 10_000);
          this.authResolve = () => {
            clearTimeout(authTimeout);
            clearTimeout(timeout);
            this.log('Tunnel ready');
            this.emit('connected');
            resolve(channel);
          };
          channel.send(encodeTunnelFrame(TunnelFrameType.AUTH, 0, this.accessKey));
        });
      });
    });

    signal.on('OFFER', async (data: any, ack: Function) => {
      try {
        await pc.setRemoteDescription(JSON.parse(data.offer));
        remoteDescriptionSet = true;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer as any);
        signal.emit('ANSWER', {
          answer: JSON.stringify(pc.localDescription),
          roomId: this.roomId,
          peerId: signal.id,
          kind: 'minecraft',
        });
        for (const candidate of pending.splice(0))
          await pc.addIceCandidate(toCandidate(candidate));
        ack({ accepted: true });
      } catch (error) {
        ack({ error: String(error), retry: true });
      }
    });

    signal.on('ERROR', (error: any) => {
      const message = error?.error || error?.message || 'Signaling rejected the connection';
      this.log(`Signaling error: ${message}`, true);
      rejectConnection(new Error(message));
    });
    signal.on('ROOM_CLOSED', () => {
      this.log('The hosted Minecraft room closed', true);
      rejectConnection(new Error('The hosted Minecraft room closed'));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        signal.once('connect', () => {
          signal.emit('JOIN_ROOM', {
            roomId: this.roomId,
            peerId: signal.id,
            kind: 'minecraft',
            version: '1',
          });
          resolve();
        });
        signal.once('connect_error', reject);
      });
      return await channelPromise;
    } catch (error) {
      this.disconnectPeer();
      throw error;
    }
  }

  private onMessage(raw: unknown) {
    try {
      const frame = decodeTunnelFrame(raw);
      if (frame.type === TunnelFrameType.AUTH_OK) {
        this.authResolve?.();
        this.authResolve = undefined;
        return;
      }
      if (frame.type === TunnelFrameType.PING) {
        this.send(TunnelFrameType.PONG, 0);
        return;
      }
      if (frame.type === TunnelFrameType.PONG) return;
      const socket = this.streams.get(frame.streamId);
      if (!socket) return;
      if (frame.type === TunnelFrameType.DATA) socket.write(frame.payload);
      if (frame.type === TunnelFrameType.END) socket.end();
      if (frame.type === TunnelFrameType.RESET) socket.destroy();
    } catch {
      this.disconnectPeer();
    }
  }

  private send(type: TunnelFrameType, streamId: number) {
    if (this.channel?.readyState === 'open')
      this.channel.send(encodeTunnelFrame(type, streamId));
  }

  private disconnectPeer() {
    if (this.disconnecting) return;
    this.disconnecting = true;
    for (const socket of this.streams.values()) socket.destroy();
    this.streams.clear();
    this.channel?.close();
    this.pc?.close().catch(() => undefined);
    this.signal?.disconnect();
    this.channel = undefined;
    this.pc = undefined;
    this.signal = undefined;
    this.connection = undefined;
    this.authResolve = undefined;
    this.disconnecting = false;
    this.emit('disconnected');
  }

  async stop() {
    this.disconnectPeer();
    const listener = this.listener;
    this.listener = undefined;
    if (listener)
      await new Promise<void>((resolve) => listener.close(() => resolve())).catch(() => undefined);
  }
}

export async function queryMinecraftRoomStatus(roomIds: string[]): Promise<Record<string, boolean>> {
  if (!roomIds.length) return {};
  const signal = makeSignalSocket(crypto.randomBytes(24).toString('base64url'), MC_CLIENT);
  return new Promise<Record<string, boolean>>((resolve) => {
    const finish = (result: Record<string, boolean>) => {
      signal.disconnect();
      resolve(result);
    };
    const timeout = setTimeout(() => finish({}), 10_000);
    signal.once('connect', () => {
      signal.timeout(8_000).emit(ServerEvents.MC_ROOM_STATUS, { rooms: roomIds.slice(0, 50) }, (error: unknown, result: any) => {
        clearTimeout(timeout);
        if (error || !result?.rooms) finish({});
        else finish(result.rooms as Record<string, boolean>);
      });
    });
    signal.once('connect_error', () => {
      clearTimeout(timeout);
      finish({});
    });
  });
}
