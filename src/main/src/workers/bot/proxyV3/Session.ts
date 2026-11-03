/**
 * A session owns one upstream connection and any number of participants.
 *
 * Mirror + driver: every synced participant receives the full s2c stream, so
 * frozen bots keep their own world up to date (through any number of
 * configuration phases). Only the driver's c2s reaches the server, plus the
 * packets a non-driver was granted (`grant`). Control can move between
 * participants at any time with `switchTo`; when the driver leaves, `handback`
 * picks the next one.
 *
 * Reconnect: when the server connection drops, 1.20.2+ participants are put
 * into configuration (a limbo the client shows as loading) and the session
 * logs back in; the new server stream reconfigures every participant. The
 * proxy itself stores no game state.
 */
import { randomUUID } from 'node:crypto';
import minecraftData from 'minecraft-data';
import { states, type Client } from 'minecraft-protocol';

import { raceAbort } from './Barrier';
import { PacketContext, PacketPipeline } from './PacketPipeline';
import { Participant } from './Participant';
import { bootstrap } from './Takeover';
import { TypedEventEmitter } from './TypedEventEmitter';
import { Upstream } from './Upstream';
import { chatText } from './chat';
import { PluginManager } from './plugins/PluginManager';
import { readPacketId } from './tolerantParser';
import type ProxyServer from './ProxyServer';
import type { ProxyRuntimeConfig } from './internalConfig';
import type { DebugPlugin } from './plugins/Recorder';
import type {
  PacketDirection,
  ProxyGrantOptions,
  ProxyLimits,
  ProxyOperationFailure,
  ProxyOperationResult,
  ProxyPacketData,
  ProxyPacketError,
  ProxyReconnectOptions,
  ProxyReconnectState,
  ProxySessionInfo,
  ProxySwitchReceipt,
  RawPacket,
} from '../../../../../common/types/proxyApi';

/** Packets the proxy itself must always be able to read. */
const ALWAYS_DECODE = new Set([
  'keep_alive',
  'ping',
  'pong',
  'transaction',
  'custom_payload',
  'start_configuration',
  'configuration_acknowledged',
  'kick_disconnect',
]);
/** Driver packets mirrored onto frozen JNbot participants. */
const ECHOED = new Set(['position', 'position_look', 'look', 'flying', 'held_item_slot']);
const LIVENESS_REPLIES = new Set(['keep_alive', 'pong', 'transaction']);
/** Driver configuration packets re-sent to the server after a reconnect (client settings, brand, channels). */
const CLIENT_INFO = new Set(['settings', 'custom_payload']);
const SOURCE_BARRIER_MS = 2_000;
const ERROR_LOG_INTERVAL_MS = 10_000;

export interface SessionOptions {
  server: ProxyServer;
  /** The first participant; it drives. */
  driver: Participant;
  config: ProxyRuntimeConfig & { host: string; port: number };
  account: string;
}

/** `driver` is undefined when the driver left and nobody took over. */
export interface DriverEvent {
  sessionId: string;
  driver?: Participant;
  previous?: Participant;
}

type SessionEvents = {
  participant: [action: 'attached' | 'detached', participant: Participant, reason?: string];
  driver: [event: DriverEvent];
  reconnect: [state: ProxyReconnectState | undefined];
  packetError: [error: ProxyPacketError];
  /** Something `until()` or `switchingCapability` depends on changed. */
  change: [];
  close: [session: Session, reason: string];
};

interface Grant {
  participant: Participant;
  packets: ReadonlySet<string>;
  exclusive: boolean;
}

export class Session extends TypedEventEmitter<SessionEvents> {
  readonly id = randomUUID();
  readonly server: ProxyServer;
  readonly pipeline = new PacketPipeline();
  readonly participants = new Map<string, Participant>();
  readonly pluginManager: PluginManager;
  readonly limits: ProxyLimits;
  readonly config: SessionOptions['config'];
  /** Account the upstream is logged in as. */
  readonly account: string;
  readonly version: string;
  readonly protocol: number | string;
  /** Who drives after the driver leaves. Default: the previous driver, if still here. */
  handback: 'previous' | 'none' | ((session: Session, leaving: Participant) => Participant | undefined) =
    'previous';
  reconnect: ProxyReconnectOptions | false;
  reconnecting?: ProxyReconnectState;
  driverId?: string;

  #upstream!: Upstream;
  /** Previous drivers, most recent last. */
  #stack: string[] = [];
  #grants: Grant[] = [];
  /** The running switch/sync; aborted when the server connection drops. */
  #operation?: AbortController;
  #detachers = new Map<string, () => void>();
  #clientInfo = new Map<string, PacketContext>();
  #reconfigurable: boolean;
  #played = false;
  #kickReason?: string;
  #retry?: NodeJS.Timeout;
  #closed = false;
  #errorLog = new Map<string, number>();

  constructor({ server, driver, config, account }: SessionOptions) {
    super();
    this.server = server;
    this.config = config;
    this.account = account;
    const data = minecraftData(driver.version);
    // A proxy-side client's `version` is its protocol number.
    this.version = data?.version.minecraftVersion ?? String(driver.version);
    this.protocol = driver.protocol;
    this.#reconfigurable = driver.canReconfigure;
    this.reconnect = config.reconnect ?? { attempts: 5, delayMs: 5_000 };
    this.limits = {
      admissionWaitMs: 15_000,
      maxPendingAdmissions: 100,
      transferTimeoutMs: 30_000,
      debugDiskBytes: 256 * 1024 * 1024,
      ...config.limits,
    };
    this.pluginManager = new PluginManager(this);

    this.#adopt(driver, 'driver');
    this.driverId = driver.id;
    this.#upstream = this.#connect();
    this.pluginManager.start();
  }

  get upstream(): Upstream {
    return this.#upstream;
  }

  get driver(): Participant | undefined {
    return this.driverId ? this.participants.get(this.driverId) : undefined;
  }

  /** Upstream phase: `configuration` or `play` once connected. */
  get phase(): string {
    return this.#upstream.phase;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  get switchingCapability(): { supported: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (this.reconnecting) reasons.push('The session is reconnecting to the server');
    else if (this.phase !== states.PLAY) reasons.push('The server connection is not in play');
    if (!this.findProvider()) reasons.push('No bot or JNbot client with a fresh world state is connected');
    return { supported: reasons.length === 0, reasons };
  }

  info(): ProxySessionInfo {
    return {
      id: this.id,
      account: this.account,
      version: this.version,
      reconnecting: this.reconnecting,
      switching: this.switchingCapability,
      debugRecording: this.pluginManager.getPlugin<DebugPlugin>('debug')?.fileId,
      participants: [...this.participants.values()].map(({ id, username, kind, role }) => ({
        id,
        username,
        kind,
        role,
      })),
    };
  }

  onPacket(events: string | string[], handler: (ctx: PacketContext) => void): () => void {
    this.pipeline.on(events, handler);
    return () => this.pipeline.off(events, handler);
  }

  /** Add a connection that joined later or moved here. It receives nothing until `sync`/`switchTo`. */
  attach(participant: Participant): ProxyOperationResult {
    if (this.#closed) return this.#failure('session_closed', 'The session is closed');
    if (String(participant.protocol) !== String(this.protocol))
      return this.#failure('protocol_mismatch', `${this.account} plays on ${this.version}; the client must match`);
    this.#adopt(participant, 'syncing');
    return { ok: true };
  }

  /** Remove a participant without disconnecting it, e.g. to move it to another session. */
  release(participant: Participant, reason: string): void {
    this.#detach(participant, reason);
  }

  /** Bootstrap a `syncing` participant into a spectator without giving it control. */
  async sync(participant: Participant | string, options: { timeoutMs?: number } = {}): Promise<ProxyOperationResult> {
    const target = this.#resolve(participant);
    if (!target) return this.#failure('participant_missing', 'The participant is not connected');
    if (target.role !== 'syncing') return { ok: true };
    const result = await this.#exclusive(target, options.timeoutMs, (signal) => bootstrap(this, target, signal));
    this.#refreshStatus();
    return result;
  }

  /** Give control of the upstream to `participant`, bootstrapping it first if needed. */
  async switchTo(
    participant: Participant | string,
    options: { timeoutMs?: number } = {},
  ): Promise<ProxyOperationResult<ProxySwitchReceipt>> {
    const target = this.#resolve(participant);
    if (!target) return this.#failure('participant_missing', 'The participant is not connected');
    const source = this.driver;
    const receipt = (): ProxySwitchReceipt => ({
      sessionId: this.id,
      sourceParticipantId: source?.id ?? '',
      targetParticipantId: target.id,
    });
    if (target === source) return { ok: true, value: receipt() };

    const result = await this.#exclusive(target, options.timeoutMs, async (signal) => {
      try {
        if (target.role === 'syncing') await bootstrap(this, target, signal, true);
        if (source?.connected) {
          source.control.freeze();
          // Let the old driver's in-flight packets reach the server first.
          await source.barriers
            .wait(source, AbortSignal.any([signal, AbortSignal.timeout(SOURCE_BARRIER_MS)]))
            .catch(() => {});
        }
        await this.until(() => this.phase === states.PLAY, signal, 'The server stayed in configuration');
        if (!target.connected) throw new Error(`${target.username} left`);
        this.#commit(target);
      } catch (error) {
        if (source?.connected && source === this.driver) source.control.resume();
        throw error;
      }
    });
    return result.ok ? { ok: true, value: receipt() } : result;
  }

  /**
   * Let a participant that is not driving send these c2s packets to the server.
   * `exclusive` also drops the driver's packets of these names. Returns revoke.
   */
  grant(
    participant: Participant | string,
    packets: string | readonly string[],
    { exclusive = false }: ProxyGrantOptions = {},
  ): () => void {
    const target = this.#resolve(participant);
    if (!target) throw new Error('The participant is not connected');
    const grant: Grant = { participant: target, packets: new Set(typeof packets === 'string' ? [packets] : packets), exclusive };
    this.#grants.push(grant);
    return () => {
      this.#grants = this.#grants.filter((entry) => entry !== grant);
    };
  }

  /** Resolves once `check()` holds; re-evaluated whenever the session changes. */
  until(check: () => boolean, signal: AbortSignal, message: string): Promise<void> {
    if (check()) return Promise.resolve();
    let onChange = () => {};
    return raceAbort(
      new Promise<void>((resolve) => {
        onChange = () => check() && resolve();
        this.on('change', onChange);
      }),
      signal,
      message,
    ).finally(() => this.off('change', onChange));
  }

  /** A mirrored bot or JNbot client whose state can bootstrap another participant. */
  findProvider(exclude?: Participant): Participant | undefined {
    for (const p of this.participants.values())
      if (p !== exclude && p.connected && p.role !== 'syncing' && p.isProviderFresh) return p;
    return undefined;
  }

  tell(message: string): void {
    this.driver?.tell(message);
  }

  /**
   * Send a packet. c2s goes upstream as if the driver sent it; s2c goes to one
   * participant (or every synced one) through its phase gate. Handlers do not run.
   */
  write(direction: PacketDirection, name: string, data: ProxyPacketData, participantId?: string): boolean {
    return this.#send(direction, participantId, (client) => ({
      name,
      data,
      buffer: client.serializer.createPacketBuffer({ name, params: data }),
    }));
  }

  writeRaw(direction: PacketDirection, raw: RawPacket, participantId?: string): boolean {
    const buffer = Buffer.from(raw);
    return this.#send(direction, participantId, () => ({
      name: `unknown_${readPacketId(buffer)}`,
      data: null,
      buffer,
      unparsed: true,
    }));
  }

  kick(participantId: string, reason = 'Kicked'): boolean {
    const participant = this.participants.get(participantId);
    participant?.end(reason);
    return !!participant;
  }

  end(reason = 'Session closed'): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#retry);
    this.#operation?.abort();
    this.pluginManager.stop();
    this.pipeline.clear();
    for (const participant of [...this.participants.values()]) participant.end(reason);
    this.participants.clear();
    this.#upstream.end();
    global.log?.(`[proxy] session ${this.id} ended: ${reason}`);
    this.emit('close', this, reason);
  }

  /** @internal Whether a packet must be decoded: someone listens, or the proxy needs it. */
  decodes(name: string | undefined, state: string, participant?: Participant): boolean {
    if (state !== states.PLAY) return true;
    if (!name) return false;
    if (ALWAYS_DECODE.has(name) || this.pipeline.hasListeners(name)) return true;
    if (participant)
      return (
        participant.pipeline.hasListeners(name) ||
        (ECHOED.has(name) && this.#hasLinkedSpectator()) ||
        (name.startsWith('chat_') && !this.#ownsAccount(participant))
      );
    for (const p of this.participants.values()) if (p.pipeline.hasListeners(name)) return true;
    return false;
  }

  /** @internal A c2s packet from one of the participants. */
  receive(participant: Participant, ctx: PacketContext): void {
    const { name, data, state } = ctx;
    if (!participant.connected || (state !== states.PLAY && state !== states.CONFIGURATION)) return;
    if (name === 'custom_payload' && data && participant.control.accept(data)) return;

    const driving = participant === this.driver;
    if (LIVENESS_REPLIES.has(name)) {
      if (name === 'keep_alive' && participant.barriers.consume(data?.keepAliveId)) return;
      if (driving && this.#upstream.answer(name, data)) return;
      if (name !== 'transaction') return;
    }
    // The upstream acknowledged the server's switch to configuration itself.
    if (name === 'configuration_acknowledged') return participant.enterPhase(states.CONFIGURATION);

    const finished = name === 'finish_configuration' && state === states.CONFIGURATION;
    if (!finished) {
      this.#run(this.pipeline, ctx, participant);
      this.#run(participant.pipeline, ctx, participant);
    }
    if (!driving) {
      if (state === states.CONFIGURATION) participant.configReplies.push(ctx);
      else if (this.#granted(participant, name)) this.#upstream.send(ctx);
    } else if (!this.#blockedForAccount(participant, ctx) && !this.#claimed(name)) {
      if (state === states.CONFIGURATION && CLIENT_INFO.has(name))
        this.#clientInfo.set(`${name}:${data?.channel ?? ''}`, ctx);
      this.#echo(participant, ctx);
      this.#upstream.send(ctx);
    }
    if (finished) participant.enterPhase(states.PLAY);
  }

  /** @internal */
  reportWriteFailure(ctx: PacketContext, participant: Participant): void {
    this.#report(ctx, participant);
  }

  #connect(): Upstream {
    return new Upstream({
      host: this.config.host,
      port: this.config.port,
      version: this.version,
      account: this.account,
      decode: (name, state) => this.decodes(name, state),
      driverLive: () => !!this.driver && !this.driver.isHeld,
      onPacket: (ctx, liveness) => this.#onUpstream(ctx, liveness),
      onPhase: (phase) => this.#onPhase(phase),
      onEnd: (reason) => this.#onUpstreamEnd(reason),
    });
  }

  #onPhase(phase: string): void {
    if (phase === states.CONFIGURATION && this.reconnecting)
      for (const ctx of this.#clientInfo.values()) this.#upstream.send(ctx);
    if (phase === states.PLAY) {
      this.#played = true;
      if (this.reconnecting) {
        this.reconnecting = undefined;
        this.#broadcast('§aReconnected to the server.');
        this.#refreshStatus();
        this.emit('reconnect', undefined);
      }
    }
    this.emit('change');
  }

  /** Keep the participants in configuration and log back in, or end the session. */
  #onUpstreamEnd(error: string): void {
    if (this.#closed) return;
    const reason = this.#kickReason || error || 'Disconnected from the server';
    this.#kickReason = undefined;
    const attempt = (this.reconnecting?.attempt ?? 0) + 1;
    const options = this.reconnect;
    if (!options || !this.#canReconnect() || attempt > options.attempts) return this.end(reason);

    this.#operation?.abort(new Error('The server connection was lost'));
    this.reconnecting = { attempt, attempts: options.attempts, reason };
    if (attempt === 1) this.#broadcast(`§cLost connection: §f${reason}`);
    this.#refreshStatus();
    for (const participant of this.participants.values()) {
      // Packets of the old stream must never reach the new one.
      participant.reset();
      participant.reconfigure(AbortSignal.timeout(this.limits.transferTimeoutMs)).catch(() => {});
    }
    this.emit('reconnect', this.reconnecting);
    this.emit('change');
    global.log?.(`[proxy] session ${this.id} reconnecting (${attempt}): ${reason}`);
    this.#retry = setTimeout(() => {
      this.#upstream = this.#connect();
      this.emit('change');
    }, options.delayMs);
  }

  #canReconnect(): boolean {
    return !!this.reconnect && this.#reconfigurable && this.#played && this.participants.size > 0;
  }

  #onUpstream(ctx: PacketContext, liveness: boolean): void {
    if (liveness) return this.driver?.deliver(ctx);
    // A kick is kept from the clients while the session can log back in.
    const kick = ctx.name === 'kick_disconnect' || (ctx.name === 'disconnect' && ctx.state === states.CONFIGURATION);
    if (kick && this.#canReconnect()) {
      this.#kickReason = chatText(ctx.data?.reason);
      return;
    }
    this.#run(this.pipeline, ctx);
    for (const participant of this.participants.values()) {
      if (!participant.mirrors) continue;
      if (!participant.pipeline.hasListeners(ctx.name)) {
        participant.deliver(ctx);
        continue;
      }
      const own = ctx.fork(participant.id);
      this.#run(participant.pipeline, own, participant);
      participant.deliver(own);
    }
  }

  #granted(participant: Participant, name: string): boolean {
    return this.#grants.some((g) => g.participant === participant && g.packets.has(name));
  }

  /** A packet name another participant was granted exclusively. */
  #claimed(name: string): boolean {
    return this.#grants.some((g) => g.exclusive && g.participant !== this.driver && g.packets.has(name));
  }

  /**
   * A client driving someone else's account can't send its own chat signing
   * session; signed chat is sent unsigned instead.
   */
  #blockedForAccount(participant: Participant, ctx: PacketContext): boolean {
    if (this.#ownsAccount(participant)) return false;
    if (ctx.name === 'chat_session_update') return true;
    const data = ctx.data;
    if (ctx.name === 'chat_message' && data?.signature) {
      data.signature = undefined;
      ctx.markModified();
    } else if (ctx.name === 'chat_command_signed' && data?.argumentSignatures?.length) {
      data.argumentSignatures = [];
      ctx.markModified();
    }
    return false;
  }

  #ownsAccount(participant: Participant): boolean {
    return participant.username.toLowerCase() === this.account.toLowerCase();
  }

  #echo(driver: Participant, ctx: PacketContext): void {
    const data = ctx.data;
    if (!data || ctx.state !== states.PLAY || !ECHOED.has(ctx.name)) return;
    let player: Record<string, unknown>;
    if (ctx.name === 'held_item_slot') {
      player = { selectedSlot: data.slotId };
    } else {
      const { x, y, z, yaw, pitch } = data;
      const onGround = data.onGround ?? data.flags?.onGround;
      player = {
        position: Object.fromEntries(
          Object.entries({ x, y, z, yaw, pitch, onGround }).filter(([, v]) => v !== undefined),
        ),
      };
    }
    for (const p of this.participants.values())
      if (p !== driver && p.role === 'spectator') p.control.sync(player);
  }

  #hasLinkedSpectator(): boolean {
    for (const p of this.participants.values()) if (p.role === 'spectator' && p.control.linked) return true;
    return false;
  }

  #adopt(participant: Participant, role: Participant['role']): void {
    participant.session = this;
    participant.role = role;
    this.participants.set(participant.id, participant);
    const onChange = () => this.emit('change');
    const onLeave = (reason: string) => this.#detach(participant, reason);
    participant.on('change', onChange);
    participant.once('leave', onLeave);
    this.#detachers.set(participant.id, () => {
      participant.off('change', onChange);
      participant.off('leave', onLeave);
    });
    this.emit('participant', 'attached', participant);
  }

  #commit(target: Participant): void {
    const previous = this.driver;
    if (previous && previous !== target) {
      previous.role = 'spectator';
      previous.control.freeze();
      this.#stack.push(previous.id);
    }
    this.#stack = this.#stack.filter((id) => id !== target.id);
    target.role = 'driver';
    this.driverId = target.id;
    this.#upstream.answerPending();
    target.control.resume();
    this.#refreshStatus();
    global.log?.(`[proxy] ${target.username} now drives session ${this.id}`);
    this.emit('driver', { sessionId: this.id, driver: target, previous });
  }

  #detach(participant: Participant, reason: string): void {
    if (!this.participants.delete(participant.id)) return;
    this.#detachers.get(participant.id)?.();
    this.#detachers.delete(participant.id);
    if (participant.session === this) participant.session = undefined;
    participant.status = undefined;
    this.#stack = this.#stack.filter((id) => id !== participant.id);
    this.#grants = this.#grants.filter((g) => g.participant !== participant);
    this.emit('participant', 'detached', participant, reason);
    this.emit('change');
    if (this.#closed) return;
    if (!this.participants.size) return this.end(`${participant.username} left`);
    if (participant.id !== this.driverId) return;

    this.driverId = undefined;
    const next = this.#handbackTarget(participant);
    if (!next) {
      this.#upstream.answerPending();
      this.#refreshStatus();
      this.emit('driver', { sessionId: this.id, driver: undefined, previous: participant });
      return;
    }
    // Mid-configuration the server may still wait for replies the old driver never sent.
    if (this.phase === states.CONFIGURATION)
      for (const ctx of next.configReplies)
        if (!this.#upstream.sentConfig.has(ctx.name)) this.#upstream.send(ctx);
    this.#commit(next);
  }

  #handbackTarget(leaving: Participant): Participant | undefined {
    if (this.handback === 'none') return undefined;
    if (typeof this.handback === 'function') {
      const chosen = this.handback(this, leaving);
      return chosen?.connected && chosen.role !== 'syncing' ? chosen : undefined;
    }
    for (let i = this.#stack.length - 1; i >= 0; i--) {
      const candidate = this.participants.get(this.#stack[i]);
      if (candidate?.role === 'spectator') return candidate;
    }
    return undefined;
  }

  /** Spectators and a reconnecting session say so on screen. */
  #refreshStatus(): void {
    const driver = this.driver?.username;
    const reconnecting = this.reconnecting;
    for (const p of this.participants.values())
      p.status = reconnecting
        ? `Reconnecting to the server (${reconnecting.attempt}/${reconnecting.attempts})…`
        : p.role === 'spectator'
          ? `Spectating · ${driver ? `${driver} is playing` : 'nobody is playing'}`
          : undefined;
  }

  #broadcast(message: string): void {
    for (const p of this.participants.values()) if (p.kind !== 'bot') p.tell(message);
  }

  /** One switch/sync at a time, bounded by a timeout and aborted when the server connection drops. */
  async #exclusive(
    target: Participant,
    timeoutMs: number | undefined,
    run: (signal: AbortSignal) => Promise<void>,
  ): Promise<ProxyOperationResult> {
    if (this.#operation) return this.#failure('switch_busy', 'Another switch is in progress', target.id);
    const operation = new AbortController();
    this.#operation = operation;
    const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(timeoutMs ?? this.limits.transferTimeoutMs)]);
    try {
      await run(signal);
      return { ok: true };
    } catch (error) {
      return this.#failure(
        signal.aborted && !operation.signal.aborted ? 'switch_timeout' : 'switch_failed',
        error instanceof Error ? error.message : String(error),
        target.id,
      );
    } finally {
      this.#operation = undefined;
    }
  }

  #resolve(participant: Participant | string): Participant | undefined {
    const found =
      typeof participant === 'string'
        ? (this.participants.get(participant) ??
          [...this.participants.values()].find((p) => p.username === participant))
        : participant;
    return found?.connected && this.participants.has(found.id) ? found : undefined;
  }

  #send(
    direction: PacketDirection,
    participantId: string | undefined,
    build: (client: Client) => { name: string; data: any; buffer: Buffer; unparsed?: boolean },
  ): boolean {
    try {
      if (direction === 'c2s') {
        const client = this.#upstream.client;
        this.#upstream.send(new PacketContext({ ...build(client), state: client.state, direction, sessionId: this.id, origin: 'local' }));
        return true;
      }
      const targets = participantId
        ? [this.participants.get(participantId)].filter((p): p is Participant => !!p)
        : [...this.participants.values()].filter((p) => p.mirrors);
      for (const p of targets)
        p.deliver(new PacketContext({ ...build(p.client), state: p.phase, direction, sessionId: this.id, targetParticipantId: p.id, origin: 'local' }));
      return targets.length > 0;
    } catch (error) {
      console.error('[proxy] write failed:', error);
      return false;
    }
  }

  #run(pipeline: PacketPipeline, ctx: PacketContext, participant?: Participant): void {
    pipeline.run(ctx);
    if (ctx.failure || (ctx.unparsed && pipeline.hasListeners(ctx.name))) this.#report(ctx, participant);
  }

  #report(ctx: PacketContext, participant?: Participant): void {
    const code = !ctx.failure ? 'parse' : ctx.failure.code === 'serialization_error' ? 'serialize' : 'handler';
    const error: ProxyPacketError = {
      sessionId: this.id,
      participantId: participant?.id,
      name: ctx.name,
      direction: ctx.direction,
      code,
      message: ctx.failure?.message ?? 'The packet could not be decoded for this version',
    };
    this.emit('packetError', error);
    const key = `${code}:${ctx.direction}:${ctx.name}`;
    const now = Date.now();
    if (now - (this.#errorLog.get(key) ?? 0) < ERROR_LOG_INTERVAL_MS) return;
    this.#errorLog.set(key, now);
    global.log?.(`[proxy] ${code} error on ${ctx.direction} "${ctx.name}": ${error.message}`, 'warning');
  }

  #failure(code: string, message: string, participantId?: string): ProxyOperationFailure {
    return { ok: false, code, message, sessionId: this.id, participantId };
  }
}
