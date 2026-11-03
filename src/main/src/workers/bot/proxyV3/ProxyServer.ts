import { createServer, Server, Client } from 'minecraft-protocol';

import { raceAbort } from './Barrier';
import { Participant } from './Participant';
import { Session, type DriverEvent } from './Session';
import { TypedEventEmitter } from './TypedEventEmitter';
import type { ProxyRuntimeConfig } from './internalConfig';
import type { PacketHandler } from './PacketPipeline';
import type {
  ProxyAdmissionDecision,
  ProxyAdmissionHandler,
  ProxyAdmissionRequest,
  ProxyInfo,
  ProxyOperationFailure,
  ProxyOperationResult,
  ProxyPacketError,
  ProxyReconnectState,
  ProxySwitchReceipt,
} from '../../../../../common/types/proxyApi';

declare module 'minecraft-protocol' {
  interface ServerOptions {
    manualConfiguration?: boolean;
    fallbackVersion?: string;
  }
}

type ProxyServerEvents = {
  session: [action: 'created' | 'ended', session: Session, reason?: string];
  participant: [action: 'attached' | 'detached', participant: Participant, session: Session, reason?: string];
  driver: [event: DriverEvent & { session: Session }];
  reconnect: [session: Session, state: ProxyReconnectState | undefined];
  packetError: [error: ProxyPacketError];
  /** Anything `getInfo()` reports may have changed. Batched per tick. */
  change: [];
};

/**
 * Listener and admission coordinator. Who drives a session is up to its users;
 * `switch` and `move` are the high-level ways to hand over control.
 */
class ProxyServer extends TypedEventEmitter<ProxyServerEvents> {
  readonly server: Server;
  readonly ready: Promise<void>;
  readonly config: ProxyRuntimeConfig & { host: string; port: number; proxyPort: number };

  #sessions = new Map<string, Session>();
  #admissionHandlers: ProxyAdmissionHandler[] = [];
  #packetSubscriptions = new Set<{ events: string | string[]; handler: PacketHandler }>();
  #pendingAdmissions = new Set<AbortController>();
  #changeQueued = false;
  #stopped = false;

  constructor(config: ProxyRuntimeConfig = {}) {
    super();
    const host = config.host || global.appSettings?.ip || '127.0.0.1';
    const port = config.port || Number(global.appSettings?.port || 25565) || 25565;
    const isLocalServer = (host === '127.0.0.1' || host === 'localhost') && port === 25565;
    this.config = {
      ...config,
      proxyPort: config.proxyPort || (isLocalServer ? 25577 : 25565),
      host,
      port,
    };

    this.server = createServer({
      version: false as any,
      fallbackVersion: config.fallbackVersion,
      'online-mode': config.onlineMode === true,
      keepAlive: false,
      hideErrors: true,
      manualConfiguration: true,
      port: this.config.proxyPort,
      motd: '§6§lJNbot §eProxy',
      maxPlayers: 100,
      beforePing: (response, client, send) => {
        response.version.name = '§6JNbot Proxy';
        if (typeof client.protocolVersion === 'number')
          response.version.protocol = client.protocolVersion;
        send?.(null, response);
      },
    });

    // Sessions relay the real upstream configuration instead of nmp's own.
    this.server.on('configurationLogin' as any, (client: Client) => {
      (client as any).proxyConfigurationReady = true;
      client.emit('proxy_configuration_ready');
    });

    this.ready = new Promise<void>((resolve, reject) => {
      this.server.once('listening', resolve);
      this.server.once('error', reject);
    });

    this.server.on('login', (client) => void this.#onLogin(client as Client));
    this.server.on('listening', () =>
      global.log?.(
        `[proxy] listening on :${this.config.proxyPort} → ${this.config.host}:${this.config.port}`,
      ),
    );
    // JNbot mod clients show the sessions they can move to.
    this.on('change', () => this.#publishSessions());
  }

  get sessions(): ReadonlyMap<string, Session> {
    return this.#sessions;
  }

  get pendingAdmissions(): number {
    return this.#pendingAdmissions.size;
  }

  getSession(id: string): Session | undefined {
    return this.#sessions.get(id);
  }

  getParticipants(): Participant[] {
    return [...this.#sessions.values()].flatMap((s) => [...s.participants.values()]);
  }

  getParticipant(idOrUsername: string): Participant | undefined {
    return this.getParticipants().find(
      (p) => p.id === idOrUsername || p.username === idOrUsername,
    );
  }

  /** Give `target` control of the session it is in. */
  async switch(target: Participant | string): Promise<ProxyOperationResult<ProxySwitchReceipt>> {
    const participant = this.#participant(target);
    if (!participant?.session) return missing(target);
    return participant.session.switchTo(participant);
  }

  /**
   * Move a connected participant into another session without disconnecting it:
   * the client is put back into configuration and bootstrapped from the target's
   * provider. It drives the target unless `drive` is false.
   */
  async move(
    target: Participant | string,
    sessionOrId: Session | string,
    { drive = true, timeoutMs }: { drive?: boolean; timeoutMs?: number } = {},
  ): Promise<ProxyOperationResult> {
    const participant = this.#participant(target);
    const session = typeof sessionOrId === 'string' ? this.#sessions.get(sessionOrId) : sessionOrId;
    if (!participant) return missing(target);
    if (!session || session.isClosed)
      return { ok: false, code: 'session_missing', message: 'The session is no longer connected' };
    if (participant.session === session)
      return drive ? session.switchTo(participant, { timeoutMs }) : { ok: true };
    const fail = (code: string, message: string): ProxyOperationResult => ({
      ok: false,
      code,
      message,
      sessionId: session.id,
      participantId: participant.id,
    });
    if (!participant.canReconfigure)
      return fail('reconfigure_unsupported', 'Moving between sessions needs Minecraft 1.20.2 or newer');
    if (String(participant.protocol) !== String(session.protocol))
      return fail('protocol_mismatch', `${session.account} plays on ${session.version}`);
    const { supported, reasons } = session.switchingCapability;
    if (!supported) return fail('switching_unavailable', reasons.join('. '));

    participant.session?.release(participant, `Moved to ${session.account}`);
    participant.reset();
    const attached = session.attach(participant);
    if (!attached.ok) {
      participant.end(attached.message);
      return attached;
    }
    try {
      await participant.reconfigure(AbortSignal.timeout(timeoutMs ?? session.limits.transferTimeoutMs));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      participant.end(`Could not move: ${message}`);
      return fail('switch_failed', message);
    }
    return drive ? session.switchTo(participant, { timeoutMs }) : session.sync(participant, { timeoutMs });
  }

  tell(target: Participant | string, message: string): void {
    this.#participant(target)?.tell(message);
  }

  broadcast(message: string): void {
    for (const participant of this.getParticipants()) participant.tell(message);
  }

  kick(target: Participant | string, reason = 'You have been kicked'): void {
    this.#participant(target)?.end(reason);
  }

  /** Handlers run in order; the first to return a decision wins. Default: a new session. */
  onAdmission(handler: ProxyAdmissionHandler): () => void {
    this.#admissionHandlers.push(handler);
    return () => {
      this.#admissionHandlers = this.#admissionHandlers.filter((e) => e !== handler);
    };
  }

  /** Run `handler` in every session's pipeline, current and future. */
  onPacket(events: string | string[], handler: PacketHandler): () => void {
    const subscription = { events, handler };
    this.#packetSubscriptions.add(subscription);
    for (const session of this.#sessions.values()) session.pipeline.on(events, handler);
    return () => {
      this.#packetSubscriptions.delete(subscription);
      for (const session of this.#sessions.values()) session.pipeline.off(events, handler);
    };
  }

  getInfo(): ProxyInfo {
    return {
      sessions: [...this.#sessions.values()].map((session) => session.info()),
      config: { port: this.config.proxyPort, onlineMode: this.config.onlineMode === true },
    };
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const controller of this.#pendingAdmissions) controller.abort();
    this.#pendingAdmissions.clear();
    this.#admissionHandlers = [];
    this.#packetSubscriptions.clear();
    for (const session of this.#sessions.values()) session.end('Proxy stopped');
    this.#sessions.clear();
    this.server.close();
  }

  async #onLogin(client: Client): Promise<void> {
    if (this.#stopped) return client.end('Proxy stopped');

    const controller = new AbortController();
    this.#pendingAdmissions.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.config.limits?.admissionWaitMs ?? 15_000);
    const cancel = () => controller.abort();
    client.once('end', cancel);
    client.once('error', cancel);

    try {
      const decision = await this.#decide({
        username: client.username,
        protocol: client.protocolVersion ?? client.version,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return client.end('Proxy admission cancelled');
      if (decision.type === 'reject') return client.end(decision.reason);

      const participant = new Participant(client, {
        kind: decision.kind,
        provider: decision.provider,
        resolveBotProvider: this.config.resolveBotStateProvider,
      });
      participant.control.on('request', (message) => this.#onRequest(participant, message));
      if (decision.type === 'new-session') return this.#startSession(participant, decision);

      const result = this.#sessions.get(decision.sessionId)?.attach(participant);
      if (!result?.ok) participant.end(result?.message ?? 'The proxy session no longer exists');
    } catch (error) {
      global.log?.(`[proxy] admission failed: ${error instanceof Error ? error.message : error}`, 'error');
      client.end(error instanceof Error ? error.message : 'Proxy admission failed');
    } finally {
      clearTimeout(timeout);
      client.off('end', cancel);
      client.off('error', cancel);
      this.#pendingAdmissions.delete(controller);
    }
  }

  #startSession(participant: Participant, decision: Extract<ProxyAdmissionDecision, { type: 'new-session' }>) {
    const session = new Session({
      server: this,
      driver: participant,
      config: {
        ...this.config,
        host: decision.host ?? this.config.host,
        port: decision.port ?? this.config.port,
      },
      account: decision.account ?? participant.username,
    });
    session.on('participant', (action, p, reason) => {
      this.emit('participant', action, p, session, reason);
      this.#changed();
    });
    session.on('driver', (event) => {
      this.emit('driver', { ...event, session });
      this.#changed();
    });
    session.on('reconnect', (state) => this.emit('reconnect', session, state));
    session.on('change', () => this.#changed());
    session.on('packetError', (error) => this.emit('packetError', error));
    session.on('close', (_, reason) => {
      if (this.#sessions.delete(session.id)) this.emit('session', 'ended', session, reason);
      this.#changed();
    });
    for (const { events, handler } of this.#packetSubscriptions) session.pipeline.on(events, handler);

    this.#sessions.set(session.id, session);
    this.emit('session', 'created', session);
    this.emit('participant', 'attached', participant, session);
    this.#changed();
    global.log?.(`[proxy] session ${session.id} connected as ${session.account} (${session.version})`);
  }

  async #decide(request: ProxyAdmissionRequest): Promise<ProxyAdmissionDecision> {
    if (this.#pendingAdmissions.size > (this.config.limits?.maxPendingAdmissions ?? 100))
      return { type: 'reject', reason: 'Proxy admission queue is full' };
    for (const handler of this.#admissionHandlers) {
      const decision = await raceAbort(
        Promise.resolve(handler(request)),
        request.signal,
        'Proxy admission timed out',
      );
      if (decision) return decision;
    }
    return { type: 'new-session' };
  }

  /** Control-channel requests from a JNbot mod client. */
  #onRequest(participant: Participant, message: Record<string, unknown>): void {
    if (message.type !== 'join' || typeof message.sessionId !== 'string') return;
    void this.move(participant, message.sessionId).then((result) => {
      if (!result.ok && participant.connected) participant.tell(`§c${result.message}`);
    });
  }

  #publishSessions(): void {
    const sessions = [...this.#sessions.values()].map((session) => ({
      id: session.id,
      account: session.account,
      version: session.version,
      driver: session.driver?.username ?? null,
      players: session.participants.size,
      joinable: session.switchingCapability.supported,
    }));
    for (const participant of this.getParticipants())
      if (participant.kind === 'client')
        participant.control.send('sessions', { current: participant.session?.id, sessions });
  }

  #changed(): void {
    if (this.#changeQueued) return;
    this.#changeQueued = true;
    setImmediate(() => {
      this.#changeQueued = false;
      if (!this.#stopped) this.emit('change');
    });
  }

  #participant(target: Participant | string): Participant | undefined {
    if (typeof target !== 'string') return target.connected ? target : undefined;
    return this.getParticipant(target);
  }
}

function missing(target: Participant | string): ProxyOperationFailure {
  const name = typeof target === 'string' ? target : target.username;
  return { ok: false, code: 'participant_missing', message: `"${name}" is not connected` };
}

export default ProxyServer;
