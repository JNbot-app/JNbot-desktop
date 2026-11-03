/**
 * One downstream connection (a JNbot bot, a JNbot mod client or a vanilla
 * client). It owns its client wiring and control link and hands every c2s
 * packet to the session it is currently in, so it can move between sessions
 * without reconnecting.
 *
 * Phase gate: every s2c packet carries the upstream phase it was read in, and
 * is only written once this client is in that same phase. Anything else waits
 * in order and is flushed by the client's own acknowledgements
 * (`enterPhase`). A held participant queues everything until `release()`.
 *
 * Packets the proxy writes itself (`send`) also wait while a phase change is in
 * flight: after `start_configuration`/`finish_configuration` the client already
 * decodes the next phase, so a packet encoded for the old one would corrupt it.
 */
import { randomUUID } from 'node:crypto';
import minecraftData from 'minecraft-data';
import { states, type Client } from 'minecraft-protocol';

import { Barriers, raceAbort } from './Barrier';
import { Control } from './Control';
import { PacketContext, PacketPipeline, writeContext } from './PacketPipeline';
import { TypedEventEmitter } from './TypedEventEmitter';
import { systemChatPacket } from './chat';
import { readPacketId } from './tolerantParser';
import { installPacketParser } from './wasmParser';
import type { Session } from './Session';
import type { ProxyRuntimeConfig } from './internalConfig';
import type {
  ProxyPacketData,
  ProxyParticipantKind,
  ProxyParticipantRole,
  ProxyStateProvider,
  RawPacket,
} from '../../../../../common/types/proxyApi';

const MAX_QUEUED_BYTES = 64 * 1024 * 1024;
const KEEP_ALIVE_MS = 10_000;
/** The action bar fades after ~3s, so a status is re-sent this often. */
const STATUS_MS = 2_000;
const TELL_WAIT_MS = 60_000;

type ParticipantEvents = {
  phase: [phase: string];
  /** Phase, kind or provider changed. */
  change: [];
  leave: [reason: string];
};

export class Participant extends TypedEventEmitter<ParticipantEvents> {
  readonly id = randomUUID();
  readonly pipeline = new PacketPipeline();
  readonly barriers = new Barriers();
  readonly control: Control;
  /** Whether it can be reconfigured: moved between sessions or kept through a reconnect. */
  readonly canReconfigure: boolean;
  kind: ProxyParticipantKind;
  /** `syncing` participants receive nothing until bootstrapped (`Session.sync`). */
  role: ProxyParticipantRole = 'syncing';
  provider?: ProxyStateProvider;
  /** Set by the session on attach. */
  session?: Session;
  connected = true;
  /** Configuration replies sent while not driving, for a mid-configuration handover. */
  configReplies: PacketContext[] = [];

  #queue: PacketContext[] = [];
  #queuedBytes = 0;
  #held = false;
  /** A phase-changing packet was written and the client has not acknowledged it yet. */
  #switching = false;
  #deferred: Array<[name: string, data: ProxyPacketData]> = [];
  #ticker: NodeJS.Timeout;
  #status?: string;
  #statusTicker?: NodeJS.Timeout;

  constructor(
    readonly client: Client,
    options: {
      kind?: ProxyParticipantKind;
      provider?: ProxyStateProvider;
      resolveBotProvider?: ProxyRuntimeConfig['resolveBotStateProvider'];
    } = {},
  ) {
    super();
    this.kind = options.kind ?? 'vanilla';
    this.provider = options.provider;
    this.canReconfigure = !!minecraftData(client.version)?.supportFeature('hasConfigurationState');
    this.control = new Control(this, options.resolveBotProvider);
    this.control.on('provider', () => {
      this.#renderStatus();
      this.emit('change');
    });

    const receive = (ctx: PacketContext) => this.session?.receive(this, ctx);
    installPacketParser(
      client,
      (raw, name) =>
        receive(this.#context(name ?? `unknown_${readPacketId(raw)}`, client.state, null, raw, true)),
      (name, state) => this.session?.decodes(name, state, this) ?? true,
    );
    client.on('packet', (data, meta, buffer) =>
      receive(this.#context(meta.name, meta.state, data, buffer)),
    );
    const enterConfiguration = () => this.enterPhase(states.CONFIGURATION);
    if ((client as any).proxyConfigurationReady) queueMicrotask(enterConfiguration);
    else client.once('proxy_configuration_ready', enterConfiguration);
    client.once('end', (reason) => {
      this.close(String(reason ?? 'Disconnected'));
    });
    client.once('error', (error) => {
      global.log?.(`[proxy] ${this.username} connection error: ${error}`, 'warning');
      this.end('Connection error');
    });

    // Upstream liveness packets only reach the driver, so the proxy keeps
    // every downstream alive itself. Echoes are swallowed by the session.
    this.#ticker = setInterval(() => {
      if (this.phase === states.PLAY || this.phase === states.CONFIGURATION)
        this.barriers.ping(this);
    }, KEEP_ALIVE_MS).unref();
  }

  get username(): string {
    return this.client.username;
  }

  get protocol(): number | string {
    return this.client.protocolVersion ?? this.client.version;
  }

  get phase(): string {
    return this.client.state;
  }

  /** Version name or, for proxy-side clients, protocol number. */
  get version(): string | number {
    return this.client.version;
  }

  get isHeld(): boolean {
    return this.#held;
  }

  /** Receives the live s2c stream (directly or into its queue). */
  get mirrors(): boolean {
    return this.connected && (this.role !== 'syncing' || this.#held);
  }

  get isProviderFresh(): boolean {
    const provider = this.provider;
    if (!provider || this.phase !== states.PLAY || !this.control.stateReady) return false;
    return provider.status?.().ready ?? true;
  }

  get status(): string | undefined {
    return this.#status;
  }

  /** A line kept on screen: the action bar of vanilla clients, the HUD of the JNbot mod. */
  set status(text: string | undefined) {
    if (text === this.#status) return;
    this.#status = text;
    this.#renderStatus();
  }

  deliver(ctx: PacketContext): void {
    if (!this.connected) return;
    if (this.#held || this.#queue.length || ctx.state !== this.phase) {
      this.#queue.push(ctx);
      this.#queuedBytes += ctx.forwardBuffer.length;
      if (this.#queuedBytes > MAX_QUEUED_BYTES) this.end('Proxy queue overflow');
      return;
    }
    this.#write(ctx);
  }

  /** Called on this client's own phase acknowledgement. */
  enterPhase(phase: string): void {
    this.#switching = false;
    if (this.client.state !== phase) this.client.state = phase as Client['state'];
    if (phase === states.CONFIGURATION) this.configReplies = [];
    this.#flush();
    for (const [name, data] of this.#deferred.splice(0)) this.send(name, data);
    if (phase === states.PLAY) this.control.offer();
    this.emit('phase', phase);
    this.emit('change');
  }

  /** Put the client back into configuration, e.g. before joining another server stream. */
  async reconfigure(signal: AbortSignal): Promise<void> {
    if (this.phase === states.PLAY) this.send('start_configuration', {});
    await this.untilPhase(states.CONFIGURATION, signal);
  }

  /** Forget everything queued for the previous server stream. */
  reset(): void {
    this.#queue = [];
    this.#queuedBytes = 0;
    this.configReplies = [];
  }

  /** Write a packet the proxy itself originates, in the client's current phase. */
  send(name: string, data: ProxyPacketData): void {
    if (!this.connected) return;
    if (this.#switching) {
      this.#deferred.push([name, data]);
      return;
    }
    try {
      this.client.write(name, data);
    } catch {
      return; // between phases or closing
    }
    this.#noteTransition(name);
  }

  hold(): void {
    this.#held = true;
  }

  release(): void {
    this.#held = false;
    this.#flush();
  }

  untilPhase(phase: string, signal: AbortSignal): Promise<void> {
    if (this.phase === phase) return Promise.resolve();
    let cleanup = () => {};
    return raceAbort(
      new Promise<void>((resolve, reject) => {
        const onPhase = (current: string) => current === phase && resolve();
        const onLeave = (reason: string) => reject(new Error(reason));
        cleanup = () => {
          this.off('phase', onPhase);
          this.off('leave', onLeave);
        };
        this.on('phase', onPhase);
        this.once('leave', onLeave);
      }),
      signal,
      `${this.username} did not reach ${phase}`,
    ).finally(() => cleanup());
  }

  /** Write bypassing the queue; used to bootstrap a held participant. */
  writeRaw(raw: RawPacket): void {
    this.client.writeRaw(Buffer.from(raw));
  }

  /** Write a packet and wait until the socket drained. */
  async writeDrained(name: string, data: ProxyPacketData, signal: AbortSignal): Promise<void> {
    this.client.write(name, data);
    const serializer = (this.client as any).serializer;
    if (!serializer?.writableNeedDrain) return;
    await raceAbort(
      new Promise<void>((resolve) => serializer.once('drain', resolve)),
      signal,
      'Bootstrap write timed out',
    );
  }

  tell(message: string, isActionBar = false): void {
    if (this.phase !== states.PLAY) {
      // Chat only exists in play: say it once the client is back there.
      if (!isActionBar)
        this.untilPhase(states.PLAY, AbortSignal.timeout(TELL_WAIT_MS)).then(() => this.tell(message), () => {});
      return;
    }
    const packet = systemChatPacket(this.version, message, isActionBar);
    if (packet) this.send(...packet);
  }

  end(reason = 'Disconnected'): void {
    if (!this.close(reason)) return;
    this.client.end(reason);
  }

  /** Mark the connection gone. Returns false when it already was. */
  close(reason: string): boolean {
    if (!this.connected) return false;
    this.connected = false;
    clearInterval(this.#ticker);
    clearInterval(this.#statusTicker);
    this.reset();
    this.#deferred = [];
    this.control.close();
    this.pipeline.clear();
    this.emit('leave', reason);
    return true;
  }

  /** The mod draws the status itself; vanilla clients get it repeated in the action bar. */
  #renderStatus(): void {
    clearInterval(this.#statusTicker);
    this.#statusTicker = undefined;
    if (!this.connected || this.kind === 'bot') return;
    if (this.control.send('status', { text: this.#status ?? null }) || !this.#status) return;
    const show = () => this.phase === states.PLAY && this.tell(`§7${this.#status}`, true);
    show();
    this.#statusTicker = setInterval(show, STATUS_MS).unref();
  }

  #context(name: string, state: string, data: any, buffer: Buffer, unparsed = false): PacketContext {
    return new PacketContext({
      name,
      state,
      direction: 'c2s',
      data,
      buffer,
      unparsed,
      sessionId: this.session?.id,
      sourceParticipantId: this.id,
    });
  }

  #flush(): void {
    while (!this.#held && this.#queue.length && this.#queue[0].state === this.phase) {
      const ctx = this.#queue.shift()!;
      this.#queuedBytes -= ctx.forwardBuffer.length;
      this.#write(ctx);
    }
  }

  #write(ctx: PacketContext): void {
    try {
      writeContext(this.client, ctx);
    } catch {
      return; // the socket is closing; 'end' detaches us
    }
    this.#noteTransition(ctx.name);
    if (ctx.failure?.code === 'serialization_error') this.session?.reportWriteFailure(ctx, this);
  }

  #noteTransition(name: string): void {
    if (
      (name === 'start_configuration' && this.phase === states.PLAY) ||
      (name === 'finish_configuration' && this.phase === states.CONFIGURATION)
    )
      this.#switching = true;
  }
}
