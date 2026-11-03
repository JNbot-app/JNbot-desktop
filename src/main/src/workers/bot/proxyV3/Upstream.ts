/**
 * The session's single connection to the real server.
 *
 * It follows the server's phase changes (nmp acknowledges `start_configuration`
 * itself in manual configuration mode) and owns liveness: keep-alives, pings
 * and anticheat window transactions are forwarded to the driver, and answered
 * by the proxy when no live driver is attached or the driver is too slow. The
 * upstream therefore never times out during a switch or after a driver left.
 */
import { createClient, states, type Client } from 'minecraft-protocol';

import { normalizeKeepAliveId } from './Barrier';
import { PacketContext, writeContext } from './PacketPipeline';
import { resolveBridgeAuth } from './auth';
import { readPacketId } from './tolerantParser';
import { installPacketParser } from './wasmParser';
import type { ProxyPacketData } from '../../../../../common/types/proxyApi';

declare module 'minecraft-protocol' {
  interface Client {
    supportFeature?(feature: string): boolean;
    protocolState?: string;
  }
  interface ClientOptions {
    manualConfiguration?: boolean;
  }
}

/** A liveness request is answered by the proxy if the driver hasn't within this time. */
const LIVENESS_FAILSAFE_MS = 5_000;

type Reply = [name: string, data: ProxyPacketData];

/** s2c liveness request → the key of its reply and the reply itself. */
function livenessRequest(name: string, data: any): [string, Reply] | undefined {
  if (!data) return undefined;
  if (name === 'keep_alive')
    return [`keep_alive:${normalizeKeepAliveId(data.keepAliveId)}`, ['keep_alive', { keepAliveId: data.keepAliveId }]];
  if (name === 'ping') return [`pong:${data.id}`, ['pong', { id: data.id }]];
  if (name === 'transaction' && data.windowId === 0 && data.action < 0 && !data.accepted)
    return [`transaction:${data.action}`, ['transaction', { windowId: 0, action: data.action, accepted: true }]];
  return undefined;
}

/** c2s liveness reply → the key of the request it answers. */
function livenessReplyKey(name: string, data: any): string | undefined {
  if (name === 'keep_alive') return `keep_alive:${normalizeKeepAliveId(data?.keepAliveId)}`;
  if (name === 'pong') return `pong:${data?.id}`;
  if (name === 'transaction') return `transaction:${data?.action}`;
  return undefined;
}

export function describeReason(reason: unknown): string {
  if (!reason) return '';
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  const text = (reason as any)?.reason;
  return typeof text === 'object' ? JSON.stringify(text) : String(text ?? '');
}

export interface UpstreamOptions {
  host: string;
  port: number;
  version: string;
  account: string;
  decode(name: string | undefined, state: string): boolean;
  /** Whether liveness requests may wait for the driver's own reply. */
  driverLive(): boolean;
  /** `liveness` packets must only reach the driver. */
  onPacket(ctx: PacketContext, liveness: boolean): void;
  onPhase(phase: string): void;
  onEnd(reason: string): void;
}

export class Upstream {
  readonly client: Client;
  /** Packet names sent upstream in the current configuration phase. */
  readonly sentConfig = new Set<string>();
  #options: UpstreamOptions;
  #sequence = 0;
  #requests = new Map<string, { reply: Reply; timer: NodeJS.Timeout }>();
  /** Driver packets sent before the upstream finished logging in. */
  #early: PacketContext[] = [];
  #ended = false;

  constructor(options: UpstreamOptions) {
    this.#options = options;
    global.log?.(
      `[proxy] opening upstream to ${options.host}:${options.port} as ${options.account} (${options.version})`,
    );
    const client = createClient({
      host: options.host,
      port: options.port,
      version: options.version,
      keepAlive: false,
      skipValidation: true,
      manualConfiguration: true,
      ...resolveBridgeAuth(options.account),
    });
    this.client = client;

    installPacketParser(
      client,
      (raw, name) => this.#receive(name ?? `unknown_${readPacketId(raw)}`, null, raw, true),
      (name, state) => options.decode(name, state),
    );
    client.on('packet', (data, meta, buffer) =>
      this.#receive(meta.name, data, buffer, false, meta.state),
    );
    client.on('state', (state: string) => {
      // A reply to the previous phase's challenge would get us kicked.
      this.#dropRequests();
      if (state === states.CONFIGURATION) this.sentConfig.clear();
      for (const ctx of this.#early.splice(0)) this.send(ctx);
      options.onPhase(state);
    });
    const onEnd = (reason: unknown) => this.#end(describeReason(reason));
    client.on('error', onEnd);
    client.on('end', onEnd);
  }

  get phase(): string {
    return this.client.state;
  }

  /**
   * Forward a c2s packet. Packets ahead of an upstream that is still logging in
   * wait for it; packets from a phase the server already left are dropped.
   */
  send(ctx: PacketContext): void {
    const { client } = this;
    if (this.#ended) return;
    if (ctx.state !== client.state) {
      if (client.state === states.LOGIN || client.state === states.HANDSHAKING) this.#early.push(ctx);
      return;
    }
    if (ctx.state === states.CONFIGURATION) this.sentConfig.add(ctx.name);
    try {
      writeContext(client, ctx);
    } catch (error) {
      global.log?.(`[proxy] upstream write failed for "${ctx.name}": ${error}`, 'warning');
      return;
    }
    if (ctx.name === 'finish_configuration' && ctx.state === states.CONFIGURATION)
      client.state = states.PLAY;
  }

  /** The driver answered a liveness request. False when it wasn't outstanding. */
  answer(name: string, data: unknown): boolean {
    const key = livenessReplyKey(name, data);
    if (!key || !this.#requests.has(key)) return false;
    this.#reply(key);
    return true;
  }

  /** Answer every outstanding liveness request now. */
  answerPending(): void {
    for (const key of [...this.#requests.keys()]) this.#reply(key);
  }

  end(): void {
    this.#end('');
    try {
      this.client.end();
    } catch {
      /* already closed */
    }
  }

  #receive(name: string, data: any, buffer: Buffer, unparsed: boolean, state = this.client.state) {
    if (this.#ended || (state !== states.PLAY && state !== states.CONFIGURATION)) return;
    const ctx = new PacketContext({
      name,
      state,
      direction: 's2c',
      data,
      buffer,
      unparsed,
      sequence: ++this.#sequence,
    });
    const request = unparsed ? undefined : livenessRequest(name, data);
    if (!request) return this.#options.onPacket(ctx, false);

    const [key, reply] = request;
    if (!this.#options.driverLive()) return this.#write(reply);
    clearTimeout(this.#requests.get(key)?.timer);
    this.#requests.set(key, {
      reply,
      timer: setTimeout(() => this.#reply(key), LIVENESS_FAILSAFE_MS),
    });
    this.#options.onPacket(ctx, true);
  }

  #reply(key: string): void {
    const request = this.#requests.get(key);
    if (!request) return;
    clearTimeout(request.timer);
    this.#requests.delete(key);
    this.#write(request.reply);
  }

  #write([name, data]: Reply): void {
    if (this.#ended) return;
    try {
      this.client.write(name, data);
    } catch (error) {
      global.log?.(`[proxy] upstream liveness reply "${name}" failed: ${error}`, 'warning');
    }
  }

  #end(reason: string): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#early = [];
    this.#dropRequests();
    this.#options.onEnd(reason);
  }

  #dropRequests(): void {
    for (const { timer } of this.#requests.values()) clearTimeout(timer);
    this.#requests.clear();
  }
}
