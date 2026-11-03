import io, { Socket } from 'socket.io-client';
import { ClientEvents, ClientType } from './SocketEvents';

type PeerError = { error: string; retry?: boolean; code?: string };

type EventName = string | symbol;
type EventListener = (...args: any[]) => void;

class LocalEventEmitter {
  private listeners = new Map<EventName, Set<EventListener>>();

  public on(event: EventName, listener: EventListener): this {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(listener);
    return this;
  }

  public once(event: EventName, listener: EventListener): this {
    const wrapper: EventListener = (...args) => { this.off(event, wrapper); listener(...args); };
    return this.on(event, wrapper);
  }

  public off(event: EventName, listener: EventListener): this {
    const set = this.listeners.get(event);
    if (!set) return this;
    set.delete(listener);
    if (set.size === 0) this.listeners.delete(event);
    return this;
  }

  public removeListener(event: EventName, listener: EventListener): this {
    return this.off(event, listener);
  }

  public removeAllListeners(event?: EventName): this {
    if (typeof event === 'undefined') { this.listeners.clear(); return this; }
    this.listeners.delete(event);
    return this;
  }

  public emit(event: EventName, ...args: any[]): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const listener of Array.from(set)) listener(...args);
    return true;
  }
}

const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 8;

abstract class WebRTC_base extends LocalEventEmitter {
  protected socket!: Socket;
  protected roomId: string | null = null;
  protected stopped = false;

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  public static VERSION = '1.0.0';
  public static SIGNAL_SERVER = 'https://jnbot-signal-server.onrender.com';

  constructor(public uid: string, public isNode: boolean) {
    super();
  }

  abstract enableWebRTC(): Promise<void>;
  abstract get isConnected(): boolean;
  abstract disconnect(): void;
  abstract send(event: string, data?: any, peerId?: string): void;

  public connect(): Promise<void> {
    if (this.socket?.connected) return Promise.resolve();
    this.stopped = false;

    return new Promise<void>((resolve, reject) => {
      const socket = io(WebRTC_base.SIGNAL_SERVER, {
        auth: {
          token: this.uid,
          type: this.isNode ? ClientType.NODE : ClientType.DEVICE,
          version: WebRTC_base.VERSION,
        },
        secure: true,
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 15_000,
        randomizationFactor: 0.5,
        transports: ['websocket'],
      });

      this.socket = socket;

      const timeout = setTimeout(() => {
        const err = new Error('Failed to connect to server');
        this.emit('socket:error', err);
        reject(err);
      }, 60_000);

      let resolved = false;
      socket.on('connect', () => {
        this.reconnectAttempts = 0;
        this.setupListeners();
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.emit('socket:connected');
          resolve();
        } else {
          this.emit('socket:reconnected');
        }
      });

      socket.on('disconnect', (reason) => {
        this.emit('socket:disconnected', reason);
      });

      socket.on('connect_error', (err) => {
        this.emit('socket:error', err);
      });
    });
  }

  protected setupListeners(): void {
    this.socket.off(ClientEvents.ERROR);
    this.socket.on(ClientEvents.ERROR, (error: PeerError) => {
      console.warn('[webrtc] peer error', error);
      this.emit('peer:error', error);
      if (this.shouldRetry(error)) this.scheduleReconnect();
    });
  }

  protected shouldRetry(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return true;
    if (!('retry' in error)) return true;
    return Boolean((error as PeerError).retry);
  }

  protected scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit('peer:fatal', { error: 'Max reconnect attempts reached' });
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(1.7, this.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.reconnect();
    }, delay);
  }

  public reconnect(): void {
    if (this.stopped) return;
    try { this.disconnect(); } catch { /* idempotent */ }
    if (this.socket?.connected) this.socket.disconnect();
    this.socket?.connect();
  }

  public stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try { this.disconnect(); } catch { /* idempotent */ }
    if (this.socket?.connected) this.socket.disconnect();
  }

  public getState(): string {
    return this.isConnected ? 'connected' : 'disconnected';
  }

  // Decode an inbound data-channel message and emit it as a local event.
  // Expected payload format: JSON-encoded [eventName, data].
  protected emitRaw(raw: unknown): void {
    this.emit('__raw', raw);
    if (typeof raw !== 'string' || raw.length === 0) return;
    try {
      const d = JSON.parse(raw) as [string, unknown];
      if (!Array.isArray(d) || typeof d[0] !== 'string') return;
      this.emit(d[0], d[1]);
    } catch (err) {
      console.info('Failed to parse peer payload', err);
    }
  }
}

export default WebRTC_base;
