import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import WebSocket from 'ws';
import {
  JNBOT_MCP_RELAY_ORIGIN,
  type McpCapability,
} from '../../../../common/mcp';
import type McpStorage from './McpStorage';

type RelayClient = { id: string; token: string };

type PairingFrame = {
  type: 'pairing_request';
  pairingId: string;
  code: string;
  clientName: string;
  requestedScopes: McpCapability[];
  expiresAt: number;
};

type RequestFrame = {
  type: 'request';
  id: string;
  installationId: string;
  clientId: string;
  scopes: McpCapability[];
  nonce: string;
  timestamp: number;
  method: string;
  headers: Record<string, string>;
  body: string;
};

type RelayFrame = PairingFrame | RequestFrame;

export class McpRelayClient {
  private socket?: WebSocket;
  private running = false;
  private reconnectTimer?: NodeJS.Timeout;
  private pairingSyncTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private readonly seenNonces = new Map<string, number>();

  constructor(
    private readonly storage: McpStorage,
    private readonly localEndpoint: () => string | undefined,
    private readonly onPairing: (frame: PairingFrame) => void,
    private readonly onStatus: (connected: boolean) => void,
    private readonly getClient: (clientId: string) => RelayClient | undefined,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stopPairingSync();
    this.socket?.close(1000, 'MCP disabled');
    this.socket = undefined;
    this.onStatus(false);
  }

  sendPairingDecision(
    pairingId: string,
    approved: boolean,
    localClientId?: string,
    scopes?: McpCapability[],
  ): void {
    this.send({
      type: 'pairing_decision',
      pairingId,
      approved,
      localClientId,
      scopes,
    });
  }

  private async connect(): Promise<void> {
    try {
      await this.registerIdentity();
      if (!this.running) return;
      const identity = this.storage.getOrCreateRelayIdentity();
      const timestamp = Date.now();
      const nonce = randomUUID();
      const message = [this.storage.installationId, timestamp, nonce].join(
        '\n',
      );
      const socketUrl = new URL(
        `/desktop/i/${this.storage.installationId}/socket`,
        JNBOT_MCP_RELAY_ORIGIN,
      );
      socketUrl.protocol = 'wss:';
      const socket = new WebSocket(socketUrl, {
        headers: {
          'x-jnbot-installation': this.storage.installationId,
          'x-jnbot-timestamp': String(timestamp),
          'x-jnbot-nonce': nonce,
          'x-jnbot-signature': this.signature(identity.privateKey, message),
        },
        maxPayload: 2 * 1024 * 1024,
        handshakeTimeout: 15_000,
      });
      this.socket = socket;
      socket.on('open', () => {
        this.reconnectAttempt = 0;
        this.onStatus(true);
        this.syncPairings();
        this.pairingSyncTimer = setInterval(() => this.syncPairings(), 15_000);
      });
      socket.on('message', (data) => void this.handleMessage(data.toString()));
      socket.on('close', () => this.disconnected());
      socket.on('error', () => this.disconnected());
    } catch {
      this.disconnected();
    }
  }

  private async registerIdentity(): Promise<void> {
    const identity = this.storage.getOrCreateRelayIdentity();
    const timestamp = Date.now();
    const nonce = randomUUID();
    const message = [
      this.storage.installationId,
      timestamp,
      nonce,
      identity.publicKey,
    ].join('\n');
    const response = await fetch(
      `${JNBOT_MCP_RELAY_ORIGIN}/desktop/i/${this.storage.installationId}/register`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installationId: this.storage.installationId,
          publicKey: identity.publicKey,
          timestamp,
          nonce,
          signature: this.signature(identity.privateKey, message),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(`Relay registration failed (${response.status})`);
  }

  private async handleMessage(message: string): Promise<void> {
    let frame: RelayFrame;
    try {
      frame = JSON.parse(message) as RelayFrame;
    } catch {
      return;
    }
    if (frame.type === 'pairing_request') {
      this.onPairing(frame);
      return;
    }
    if (
      frame.installationId !== this.storage.installationId ||
      Math.abs(Date.now() - frame.timestamp) > 60_000 ||
      this.replayed(frame.nonce)
    ) {
      return this.respond(
        frame.id,
        403,
        {},
        JSON.stringify({ error: 'invalid_relay_frame' }),
      );
    }
    const client = this.getClient(frame.clientId);
    const token = client?.token;
    const endpoint = this.localEndpoint();
    if (
      !client ||
      !token ||
      !endpoint
    ) {
      return this.respond(
        frame.id,
        403,
        {},
        JSON.stringify({ error: 'local_grant_denied' }),
      );
    }
    try {
      const headers = new Headers(frame.headers);
      headers.set('authorization', `Bearer ${token}`);
      headers.set(
        'content-type',
        headers.get('content-type') ?? 'application/json',
      );
      const response = await fetch(endpoint, {
        method: frame.method,
        headers,
        body:
          frame.method === 'GET' || frame.method === 'HEAD'
            ? undefined
            : frame.body,
        signal: AbortSignal.timeout(25_000),
      });
      const responseHeaders: Record<string, string> = {};
      for (const name of ['content-type', 'mcp-session-id']) {
        const value = response.headers.get(name);
        if (value) responseHeaders[name] = value;
      }
      this.respond(
        frame.id,
        response.status,
        responseHeaders,
        await response.text(),
      );
    } catch {
      this.respond(
        frame.id,
        504,
        {},
        JSON.stringify({ error: 'local_timeout' }),
      );
    }
  }

  private respond(
    id: string,
    status: number,
    headers: Record<string, string>,
    body: string,
  ): void {
    this.send({ type: 'response', id, status, headers, body });
  }

  private send(frame: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(frame));
  }

  private signature(privateKey: string, message: string): string {
    return sign(
      null,
      Buffer.from(message),
      createPrivateKey(privateKey),
    ).toString('base64url');
  }

  private replayed(nonce: string): boolean {
    const now = Date.now();
    for (const [value, seenAt] of this.seenNonces)
      if (seenAt < now - 2 * 60_000) this.seenNonces.delete(value);
    if (this.seenNonces.has(nonce)) return true;
    this.seenNonces.set(nonce, now);
    return false;
  }

  private syncPairings(): void {
    this.send({ type: 'sync_pairings' });
  }

  private stopPairingSync(): void {
    if (this.pairingSyncTimer) clearInterval(this.pairingSyncTimer);
    this.pairingSyncTimer = undefined;
  }

  private disconnected(): void {
    this.stopPairingSync();
    if (this.socket) this.socket.removeAllListeners();
    this.socket = undefined;
    this.onStatus(false);
    if (!this.running || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }
}

export type { PairingFrame };
export default McpRelayClient;
