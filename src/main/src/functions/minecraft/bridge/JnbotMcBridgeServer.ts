import { app } from 'electron';
import crypto, { randomUUID } from 'crypto';
import EventEmitter from 'node:events';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import packageJson from '../../../../../../release/app/package.json';

import {
  JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
  isObjectRecord,
  safeJsonParse,
  safeJsonStringify,
  type JnbotMcBridgeCommand,
  type JnbotMcBridgeEvent,
  type JnbotMcBridgeHello,
  type JnbotMcBridgeHelloAck,
  type JnbotMcBridgeMessage,
  type JnbotMcBridgeRequest,
  type JnbotMcBridgeResponse,
  type JnbotMcBridgeServerHello,
} from './protocol';

export type JnbotMcBridgeClientInfo = {
  connectionId: string;
  clientId: string;
  instanceId?: string;
  username?: string;
  uuid?: string;
  mcVersion?: string;
  modVersion?: string;
  connectedAt: number;
  lastSeenAt: number;
};

export type JnbotMcBridgeAppInfo = {
  productName: string;
  version: string;
  platform: NodeJS.Platform;
  pid: number;
  uptimeMs: number;
  websocket: { host: string; port: number };
  clients: JnbotMcBridgeClientInfo[];
};

export type JnbotMcBridgeManagedServerInfo = {
  connectionId: string;
  serverId: string;
  mcVersion?: string;
  modVersion?: string;
  capabilities: readonly string[];
  connectedAt: number;
  lastSeenAt: number;
};

type ServerOptions = {
  host?: string;
  port?: number;
  maxPayloadBytes?: number;
  authToken?: string | null;
  getAppInfo?: () => Omit<JnbotMcBridgeAppInfo, 'websocket' | 'clients'>;
};

const now = () => Date.now();

const toError = (code: string, message: string, details?: unknown) =>
  ({ code, message, details }) as const;
export type McBridgeServerEvents = {
  'client-connected': (client: JnbotMcBridgeClientInfo) => void;
  'client-disconnected': (client: JnbotMcBridgeClientInfo) => void;
  'client-event': (
    client: JnbotMcBridgeClientInfo,
    event: JnbotMcBridgeEvent,
  ) => void;
  'managed-server-connected': (server: JnbotMcBridgeManagedServerInfo) => void;
  'managed-server-disconnected': (
    server: JnbotMcBridgeManagedServerInfo,
  ) => void;
  'managed-server-event': (
    server: JnbotMcBridgeManagedServerInfo,
    event: JnbotMcBridgeEvent,
  ) => void;
};

export default class JnbotMcBridgeServer extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly maxPayloadBytes: number;
  private readonly authToken: string | null;
  private readonly getAppInfo: () => Omit<
    JnbotMcBridgeAppInfo,
    'websocket' | 'clients'
  >;

  private wss: WebSocketServer | null = null;

  private readonly sockets = new Set<WebSocket>();
  private readonly clientBySocket = new Map<
    WebSocket,
    JnbotMcBridgeClientInfo
  >();
  private readonly socketByClientId = new Map<string, WebSocket>();
  private readonly managedServerBySocket = new Map<
    WebSocket,
    JnbotMcBridgeManagedServerInfo
  >();
  private readonly socketByManagedServerId = new Map<string, WebSocket>();
  private readonly managedServerTokens = new Map<string, string>();
  private readonly requestHandlers = new Map<
    string,
    (client: JnbotMcBridgeClientInfo | undefined, params: unknown) => unknown
  >();

  private readonly pendingClientRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timeout: NodeJS.Timeout;
      socket: WebSocket;
    }
  >();

  constructor(options: ServerOptions = {}) {
    super();
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 17340;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 1024 * 1024;
    this.authToken = options.authToken ?? null;

    this.getAppInfo =
      options.getAppInfo ??
      (() => ({
        productName: app.getName(),
        version: packageJson.version,
        platform: process.platform,
        pid: process.pid,
        uptimeMs: Math.floor(process.uptime() * 1000),
      }));
  }

  start(): void {
    if (this.wss) return;


    this.wss = new WebSocketServer({
      host: this.host,
      port: this.port,
      maxPayload: this.maxPayloadBytes,
      perMessageDeflate: false,
      // Browsers always send Origin; the mod and managed servers never do.
      // Refusing it stops any website from reaching this localhost socket.
      verifyClient: ({ origin }) => !origin,
    });

    this.wss.on('connection', (socket) => this.onConnection(socket));
    this.wss.on('error', (err) =>
      console.error('[McBridge] server error', err),
    );

    console.info(
      `[McBridge] WebSocket server listening on ws://${this.host}:${this.port}`,
    );
  }

  stop(): void {
    const wss = this.wss;
    if (!wss) return;

    for (const socket of this.sockets) {
      try {
        socket.close(1001, 'Server shutting down');
      } catch {}
    }

    this.sockets.clear();
    this.clientBySocket.clear();
    this.socketByClientId.clear();
    this.managedServerBySocket.clear();
    this.socketByManagedServerId.clear();
    this.managedServerTokens.clear();
    for (const pending of this.pendingClientRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        Object.assign(new Error('Minecraft bridge stopped'), {
          code: 'bridge_stopped',
        }),
      );
    }
    this.pendingClientRequests.clear();

    this.wss = null;
    wss.close();
  }

  listClients(): JnbotMcBridgeClientInfo[] {
    return [...this.clientBySocket.values()].map((c) => ({ ...c }));
  }

  listManagedServers(): JnbotMcBridgeManagedServerInfo[] {
    return [...this.managedServerBySocket.values()].map((server) => ({
      ...server,
    }));
  }

  registerManagedServer(serverId: string, token: string): void {
    if (!serverId || !token)
      throw new Error('Server id and token are required');
    this.managedServerTokens.set(serverId, token);
  }

  revokeManagedServer(serverId: string): void {
    this.managedServerTokens.delete(serverId);
    const socket = this.socketByManagedServerId.get(serverId);
    if (!socket) return;
    this.socketByManagedServerId.delete(serverId);
    try {
      socket.close(1008, 'Managed server authorization revoked');
    } catch {}
  }

  sendCommand(clientId: string, name: string, params?: unknown): boolean {
    const socket = this.socketByClientId.get(clientId);
    if (!socket) {
      console.warn('[McBridge] sendCommand: client not connected', {
        clientId,
        name,
        knownClients: [...this.socketByClientId.keys()],
      });
      return false;
    }
    const ok = this.send(socket, {
      v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
      type: 'command',
      name,
      params,
    } satisfies JnbotMcBridgeCommand);
    if (!ok) {
      console.warn('[McBridge] sendCommand: socket not open / send failed', {
        clientId,
        name,
      });
    }
    return ok;
  }

  sendRequest<T = unknown>(
    clientId: string,
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const socket = this.socketByClientId.get(clientId);
    if (!socket) {
      return Promise.reject(new Error(`Client not connected: ${clientId}`));
    }

    const id = `srv-${randomUUID()}`;
    const timeoutMs = options?.timeoutMs ?? 5_000;

    const payload: JnbotMcBridgeRequest = {
      v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
      type: 'request',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingClientRequests.delete(id);
        reject(new Error(`Timeout waiting for client response (${method})`));
      }, timeoutMs);

      this.pendingClientRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        socket,
      });

      const ok = this.send(socket, payload);
      if (!ok) {
        clearTimeout(timeout);
        this.pendingClientRequests.delete(id);
        reject(new Error(`Failed to send request to client (${method})`));
      }
    });
  }

  sendManagedServerRequest<T = unknown>(
    serverId: string,
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const socket = this.socketByManagedServerId.get(serverId);
    if (!socket || socket.readyState !== socket.OPEN)
      return Promise.reject(
        Object.assign(new Error('Managed server API is unavailable'), {
          code: 'api_unavailable',
        }),
      );
    return this.sendRequestToSocket<T>(
      socket,
      `managed server ${serverId}`,
      method,
      params,
      options,
    );
  }

  /** Answer `method` requests sent by mod clients. */
  handle(
    method: string,
    handler: (client: JnbotMcBridgeClientInfo | undefined, params: unknown) => unknown,
  ): void {
    this.requestHandlers.set(method, handler);
  }

  broadcastCommand(name: string, params?: unknown): number {
    let sent = 0;
    for (const [socket, client] of this.clientBySocket.entries()) {
      if (!client.clientId) continue;
      if (
        this.send(socket, {
          v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
          type: 'command',
          name,
          params,
        } satisfies JnbotMcBridgeCommand)
      ) {
        sent++;
      }
    }
    return sent;
  }

  private onConnection(socket: WebSocket) {
    this.sockets.add(socket);

    socket.on('message', (data) => this.onMessage(socket, data));
    socket.on('close', () => this.onClose(socket));
    socket.on('error', (err) => {
      console.warn('[McBridge] socket error', err);
      this.onClose(socket);
    });

    const heartbeat = setInterval(() => {
      if (socket.readyState !== socket.OPEN) return;
      this.send(socket, {
        v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
        type: 'ping',
        t: now(),
      });
    }, 20_000);

    socket.once('close', () => clearInterval(heartbeat));
  }

  private onClose(socket: WebSocket) {
    this.sockets.delete(socket);
    for (const [id, pending] of this.pendingClientRequests) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timeout);
      this.pendingClientRequests.delete(id);
      pending.reject(
        Object.assign(new Error('Minecraft endpoint disconnected'), {
          code: 'api_unavailable',
        }),
      );
    }

    const info = this.clientBySocket.get(socket);
    if (info) {
      this.clientBySocket.delete(socket);
      const mappedSocket = this.socketByClientId.get(info.clientId);
      if (mappedSocket === socket) this.socketByClientId.delete(info.clientId);

      this.emit('client-disconnected', { ...info });
    }
    const managed = this.managedServerBySocket.get(socket);
    if (managed) {
      this.managedServerBySocket.delete(socket);
      if (this.socketByManagedServerId.get(managed.serverId) === socket)
        this.socketByManagedServerId.delete(managed.serverId);
      this.emit('managed-server-disconnected', { ...managed });
    }
  }

  private onMessage(socket: WebSocket, data: WebSocket.RawData) {
    const text = typeof data === 'string' ? data : data.toString('utf8');
    const parsed = safeJsonParse(text);
    if (!isObjectRecord(parsed)) return;

    const type = parsed['type'];
    const v = parsed['v'];
    if (v !== JNBOT_MC_BRIDGE_PROTOCOL_VERSION) return;
    if (typeof type !== 'string') return;

    const existingClient = this.clientBySocket.get(socket);
    const existingServer = this.managedServerBySocket.get(socket);
    if (existingClient) existingClient.lastSeenAt = now();
    if (existingServer) existingServer.lastSeenAt = now();

    if (type === 'hello') {
      if (parsed['kind'] === 'managed-server')
        this.onManagedServerHello(
          socket,
          parsed as unknown as JnbotMcBridgeServerHello,
        );
      else this.onHello(socket, parsed as unknown as JnbotMcBridgeHello);
      return;
    }

    if (!existingClient && !existingServer) {
      this.send(socket, {
        v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
        type: 'response',
        id: '0',
        ok: false,
        error: toError('not_initialized', 'Send hello first'),
      } satisfies JnbotMcBridgeResponse);
      return;
    }

    if (type === 'response') {
      this.onClientResponse(parsed as unknown as JnbotMcBridgeResponse);
      return;
    }

    if (type === 'request') {
      this.onRequest(socket, parsed as unknown as JnbotMcBridgeRequest);
      return;
    }

    if (type === 'event') {
      this.onEndpointEvent(socket, parsed as unknown as JnbotMcBridgeEvent);
      return;
    }

    if (type === 'pong') {
      return;
    }

    if (type === 'ping') {
      this.send(socket, {
        v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
        type: 'pong',
        t: typeof parsed['t'] === 'number' ? parsed['t'] : now(),
      });
    }
  }

  private onClientResponse(msg: JnbotMcBridgeResponse) {
    if (!msg || msg.v !== JNBOT_MC_BRIDGE_PROTOCOL_VERSION) return;
    if (typeof msg.id !== 'string' || !msg.id) return;

    const pending = this.pendingClientRequests.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingClientRequests.delete(msg.id);

    if (msg.ok) {
      pending.resolve(msg.result);
      return;
    }

    const message = msg.error?.message ?? 'Request failed';
    const err = new Error(message);
    (err as any).code = msg.error?.code;
    (err as any).details = msg.error?.details;
    pending.reject(err);
  }

  private onHello(socket: WebSocket, msg: JnbotMcBridgeHello) {
    if (!msg || msg.v !== JNBOT_MC_BRIDGE_PROTOCOL_VERSION) return;
    if (typeof msg.clientId !== 'string' || !msg.clientId.trim()) return;

    if (this.authToken && msg.token !== this.authToken) {
      this.send(socket, {
        v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
        type: 'response',
        id: '0',
        ok: false,
        error: toError('unauthorized', 'Invalid token'),
      } satisfies JnbotMcBridgeResponse);
      try {
        socket.close(1008, 'Unauthorized');
      } catch {}
      return;
    }

    const connectionId = randomUUID();

    const info: JnbotMcBridgeClientInfo = {
      connectionId,
      clientId: msg.clientId,
      instanceId:
        typeof msg.instanceId === 'string' ? msg.instanceId : undefined,
      username: typeof msg.username === 'string' ? msg.username : undefined,
      uuid: typeof msg.uuid === 'string' ? msg.uuid : undefined,
      mcVersion: typeof msg.mcVersion === 'string' ? msg.mcVersion : undefined,
      modVersion:
        typeof msg.modVersion === 'string' ? msg.modVersion : undefined,
      connectedAt: now(),
      lastSeenAt: now(),
    };

    this.clientBySocket.set(socket, info);
    this.socketByClientId.set(info.clientId, socket);

    const ack: JnbotMcBridgeHelloAck = {
      v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
      type: 'helloAck',
      connectionId,
      serverTime: now(),
      server: { name: 'JNbot', version: app.getVersion() },
    };

    this.send(socket, ack);

    this.emit('client-connected', { ...info });
  }

  private onManagedServerHello(
    socket: WebSocket,
    msg: JnbotMcBridgeServerHello,
  ) {
    if (!msg || msg.v !== JNBOT_MC_BRIDGE_PROTOCOL_VERSION) return;
    if (typeof msg.serverId !== 'string' || !msg.serverId.trim()) return;
    const token = this.managedServerTokens.get(msg.serverId);
    if (!token || !safeTokenEqual(token, msg.token)) {
      this.send(socket, {
        v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
        type: 'response',
        id: '0',
        ok: false,
        error: toError('unauthorized', 'Invalid managed server token'),
      } satisfies JnbotMcBridgeResponse);
      try {
        socket.close(1008, 'Unauthorized');
      } catch {}
      return;
    }
    const previous = this.socketByManagedServerId.get(msg.serverId);
    if (previous && previous !== socket) {
      try {
        previous.close(1008, 'Replaced by a newer connection');
      } catch {}
    }
    const info: JnbotMcBridgeManagedServerInfo = {
      connectionId: randomUUID(),
      serverId: msg.serverId,
      mcVersion: typeof msg.mcVersion === 'string' ? msg.mcVersion : undefined,
      modVersion:
        typeof msg.modVersion === 'string' ? msg.modVersion : undefined,
      capabilities: Array.isArray(msg.capabilities)
        ? msg.capabilities.filter(
            (capability): capability is string =>
              typeof capability === 'string',
          )
        : [],
      connectedAt: now(),
      lastSeenAt: now(),
    };
    this.managedServerBySocket.set(socket, info);
    this.socketByManagedServerId.set(info.serverId, socket);
    this.send(socket, {
      v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
      type: 'helloAck',
      connectionId: info.connectionId,
      serverTime: now(),
      server: { name: 'JNbot', version: app.getVersion() },
    } satisfies JnbotMcBridgeHelloAck);
    this.emit('managed-server-connected', { ...info });
  }

  private onEndpointEvent(socket: WebSocket, msg: JnbotMcBridgeEvent) {
    const client = this.clientBySocket.get(socket);
    if (!msg || msg.v !== JNBOT_MC_BRIDGE_PROTOCOL_VERSION) return;
    if (typeof msg.name !== 'string' || !msg.name.trim()) return;
    if (client) {
      this.emit('client-event', client, msg);
      return;
    }
    const managed = this.managedServerBySocket.get(socket);
    if (managed) this.emit('managed-server-event', managed, msg);
  }

  private onRequest(socket: WebSocket, req: JnbotMcBridgeRequest) {
    if (!req || typeof req.id !== 'string' || typeof req.method !== 'string')
      return;

    if (req.method === 'app.getInfo') {
      const base = this.getAppInfo();
      const result: JnbotMcBridgeAppInfo = {
        ...base,
        websocket: { host: this.host, port: this.port },
        clients: this.listClients(),
      };

      this.send(socket, {
        v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
        type: 'response',
        id: req.id,
        ok: true,
        result,
      } satisfies JnbotMcBridgeResponse);
      return;
    }

    const handler = this.requestHandlers.get(req.method);
    if (handler) {
      void Promise.resolve()
        .then(() => handler(this.clientBySocket.get(socket), req.params))
        .then(
          (result) => ({ ok: true, result }) as const,
          (error) => ({
            ok: false,
            error: toError('exception', String(error?.message ?? error)),
          }) as const,
        )
        .then((outcome) =>
          this.send(socket, {
            v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
            type: 'response',
            id: req.id,
            ...outcome,
          } satisfies JnbotMcBridgeResponse),
        );
      return;
    }

    this.send(socket, {
      v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
      type: 'response',
      id: req.id,
      ok: false,
      error: toError('unknown_method', `Unknown method: ${req.method}`),
    } satisfies JnbotMcBridgeResponse);
  }

  private send(socket: WebSocket, msg: JnbotMcBridgeMessage): boolean {
    if (socket.readyState !== socket.OPEN) return false;
    try {
      socket.send(safeJsonStringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private sendRequestToSocket<T>(
    socket: WebSocket,
    target: string,
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const id = `srv-${randomUUID()}`;
    const timeoutMs = options?.timeoutMs ?? 5_000;
    const payload: JnbotMcBridgeRequest = {
      v: JNBOT_MC_BRIDGE_PROTOCOL_VERSION,
      type: 'request',
      id,
      method,
      params,
    };
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingClientRequests.delete(id);
        reject(
          Object.assign(
            new Error(`Timeout waiting for ${target} response (${method})`),
            { code: 'timeout' },
          ),
        );
      }, timeoutMs);
      this.pendingClientRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        socket,
      });
      if (!this.send(socket, payload)) {
        clearTimeout(timeout);
        this.pendingClientRequests.delete(id);
        reject(new Error(`Failed to send request to ${target} (${method})`));
      }
    });
  }
}

const safeTokenEqual = (expected: string, actual: unknown) => {
  if (typeof actual !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
