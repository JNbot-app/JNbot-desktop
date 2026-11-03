/**
 * Shared types for the transparent JNbot proxy (proxyV3).
 *
 * This file is the canonical home for the public proxy API, the recording
 * format and the IPC shapes exchanged with the renderer.
 */

/** Direction of a packet relative to the player. */
export type PacketDirection = 'c2s' | 's2c';

/** Packet data decoded by minecraft-protocol for the current client version. */
export type ProxyPacketData = Record<string, unknown>;

/** A raw, decompressed Minecraft packet body. It includes the packet id. */
export type RawPacket = Uint8Array;

/** `client`: a Minecraft client running the JNbot mod. */
export type ProxyParticipantKind = 'vanilla' | 'bot' | 'client';

/**
 * - `driver`: its c2s packets reach the server (one per session).
 * - `spectator`: receives the live stream, its c2s is dropped (e.g. a frozen bot).
 * - `syncing`: joined later and receives nothing until bootstrapped.
 */
export type ProxyParticipantRole = 'driver' | 'spectator' | 'syncing';

/* ---------- state transfer (bootstrapping a participant that joins late) ---------- */

export interface ProxyStateChunk {
  x: number;
  z: number;
  /** Server-supplied heightmap metadata for this exact chunk frame. */
  heightmaps?: unknown;
  /** A Prismarine JSON column or freshly exported protocol section data. */
  column:
    | string
    | { sectionData: string; minY: number; height: number };
}

export interface ProxyStateEntity {
  id: number;
  uuid?: string;
  type: string | number;
  name?: string;
  position: { x: number; y: number; z: number; yaw?: number; pitch?: number; headYaw?: number };
  velocity?: { x: number; y: number; z: number };
  metadata?: unknown;
  attributes?: unknown[];
  equipment?: Array<{ slot: number | string; item: unknown }>;
  passengers?: number[];
  vehicleId?: number;
}

export interface ProxyStatePlayer {
  position: { x: number; y: number; z: number; yaw: number; pitch: number };
  health: number;
  food: number;
  foodSaturation: number;
  experienceBar: number;
  experienceLevel: number;
  totalExperience: number;
  selectedSlot: number;
  abilities?: ProxyPacketData;
}

export interface ProxyStateInventory {
  items: unknown[];
  cursor?: unknown;
  stateId?: number;
  window?: {
    id: number;
    type: string | number;
    title: unknown;
    slots: unknown[];
    stateId?: number;
    properties?: Record<number, number>;
  };
}

/**
 * A provider's state at one stream position. The provider owns its world model;
 * the proxy replays `handshake` verbatim and either `bootstrap` (raw packets) or
 * compiles `game`/`player`/`world`/`inventory`/`entities` into packets.
 */
export interface ProxyStateSnapshot {
  protocol: number | string;
  /** Raw packet bodies (including the packet id) exactly as the server sent them. */
  handshake: {
    /** The latest configuration phase, without liveness packets and `finish_configuration`. */
    configuration: RawPacket[];
    login: RawPacket;
    /** The latest respawn after `login`, when the dimension changed since. */
    respawn?: RawPacket;
    /** The latest copy of session-wide play packets (commands, difficulty, …). */
    singletons: RawPacket[];
  };
  /** Raw play packets that recreate the provider's world (chunks, position, inventory, …). */
  bootstrap?: RawPacket[];
  game?: {
    viewDistance?: number;
    /** Current dimension shape used to decode chunk sections. */
    dimension?: { name?: string; minY: number; height: number };
  };
  player?: ProxyStatePlayer;
  world?: { chunks: ProxyStateChunk[] };
  inventory?: ProxyStateInventory;
  entities?: ProxyStateEntity[];
  synchronization?: { teleportId?: number };
}

/** A participant that mirrors the session and can export its state (a bot or the JNbot mod). */
export interface ProxyStateProvider {
  /** Whether a capture would be faithful right now. Default: ready. */
  status?(): { ready: boolean; reasons?: readonly string[] };
  capture(signal: AbortSignal): Promise<ProxyStateSnapshot>;
}

/* ---------- results, limits, admission ---------- */

export interface ProxyOperationFailure {
  ok: false;
  code: string;
  message: string;
  sessionId?: string;
  participantId?: string;
}

export interface ProxySwitchReceipt {
  sessionId: string;
  sourceParticipantId: string;
  targetParticipantId: string;
}

export type ProxyOperationResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; value: T })
  | ProxyOperationFailure;

export interface ProxyLimits {
  admissionWaitMs: number;
  maxPendingAdmissions: number;
  /** Upper bound for one `switchTo`/`sync`/`move`, including waiting for play and a provider. */
  transferTimeoutMs: number;
  debugDiskBytes: number;
}

/**
 * Keep the participants connected when the server connection drops, and log
 * back in. Needs clients with a configuration phase (1.20.2+); older clients
 * are disconnected as before.
 */
export interface ProxyReconnectOptions {
  attempts: number;
  delayMs: number;
}

/** Set while a session is reconnecting to the server. */
export interface ProxyReconnectState {
  attempt: number;
  attempts: number;
  reason: string;
}

export interface ProxyAdmissionRequest {
  username: string;
  protocol: number | string;
  /** Aborts when the client leaves or the admission wait runs out. */
  signal: AbortSignal;
}

export type ProxyAdmissionDecision =
  | {
      type: 'new-session';
      /** Account the upstream logs in as. Default: the joining username. */
      account?: string;
      host?: string;
      port?: number;
      kind?: ProxyParticipantKind;
      provider?: ProxyStateProvider;
    }
  | {
      /** Attach to a running session as a `syncing` participant. */
      type: 'join';
      sessionId: string;
      kind?: ProxyParticipantKind;
      provider?: ProxyStateProvider;
    }
  | { type: 'reject'; reason: string };

export type ProxyAdmissionHandler = (
  request: ProxyAdmissionRequest,
) => ProxyAdmissionDecision | void | Promise<ProxyAdmissionDecision | void>;

export interface ProxyDriverEvent {
  sessionId: string;
  /** Undefined when the driver left and nobody took over. */
  driver?: ProxyParticipant;
  previous?: ProxyParticipant;
}

/** A packet the proxy could not decode, transform or re-encode. It was still forwarded. */
export interface ProxyPacketError {
  sessionId: string;
  participantId?: string;
  name: string;
  direction: PacketDirection;
  code: 'parse' | 'handler' | 'serialize';
  message: string;
}

/** Who drives after the driver leaves. `previous`: the last driver still connected. */
export type ProxyHandback =
  | 'previous'
  | 'none'
  | ((session: ProxySession, leaving: ProxyParticipant) => ProxyParticipant | undefined);

export interface ProxyGrantOptions {
  /** Also drop the driver's packets of these names while the grant holds. */
  exclusive?: boolean;
}

/* ---------- packet pipeline ---------- */

/** A packet queued after the current packet. */
export type InjectedProxyPacket =
  | { kind: 'parsed'; name: string; data: ProxyPacketData }
  | { kind: 'raw'; raw: RawPacket };

export interface PacketContext<
  T extends ProxyPacketData | null = ProxyPacketData | null,
> {
  readonly name: string;
  readonly state: string;
  readonly direction: PacketDirection;
  /** The decompressed packet body JNbot will forward, including its packet id. */
  readonly raw: RawPacket;
  /** True when JNbot could not decode this packet for the active protocol. */
  readonly unparsed: boolean;
  readonly sessionId?: string;
  readonly sourceParticipantId?: string;
  readonly targetParticipantId?: string;
  readonly sequence: number;
  /** `local`: written by the proxy or a plugin itself. */
  readonly origin: 'upstream' | 'downstream' | 'local';
  readonly failure: {
    code: 'handler_error' | 'async_handler' | 'serialization_error';
    message: string;
  } | null;
  data: T;
  readonly isModified: boolean;
  readonly isDropped: boolean;
  readonly injected: readonly InjectedProxyPacket[];
  /** Mark in-place edits to `data` for re-encoding. */
  markModified(): this;
  /** Replace this packet with a raw packet body. Works for undecodable packets. */
  replaceRaw(raw: RawPacket): this;
  /** Stop forwarding this packet. */
  drop(): this;
  /** Send a parsed packet to the same target after this packet. */
  inject(name: string, data: ProxyPacketData): this;
  /** Send a raw packet body to the same target after this packet. */
  injectRaw(raw: RawPacket): this;
}

export type PacketHandler = (context: PacketContext) => void;

export interface PacketPipeline {
  hasListeners(name: string): boolean;
  on(events: string | string[], handler: PacketHandler): this;
  once(events: string | string[], handler: PacketHandler): this;
  /** Observe final transformation intent without copying large packet payloads. */
  observe(events: string | string[], handler: PacketHandler): () => void;
  off(events: string | string[], handler: PacketHandler): this;
  clear(): void;
}

/* ---------- plugins ---------- */

export interface ProxyPluginMeta {
  name: string;
  description: string;
  commands?: ProxyCommand[];
  hidden?: boolean;
}

export interface ProxyCommand {
  name: string;
  description: string;
  args?: string[];
  hidden?: boolean;
  handler(args: string[]): void;
}

export interface ProxyPlugin {
  readonly connection: ProxySession;
  readonly meta: ProxyPluginMeta;
  readonly pipeline: PacketPipeline;
  tell(message: string): void;
  start(): void;
  stop(): void;
}

export type ProxyPluginConstructor = new (
  connection: ProxySession,
) => ProxyPlugin;

export interface PluginManager {
  readonly connection: ProxySession;
  readonly plugins: ReadonlyMap<string, ProxyPlugin>;
  readonly commands: ReadonlyMap<
    string,
    { plugin: ProxyPlugin; command: ProxyCommand }
  >;
  enablePlugin<T extends ProxyPlugin = ProxyPlugin>(plugin: ProxyPluginConstructor): T;
  disablePlugin(name: string): boolean;
  getPlugin<T extends ProxyPlugin = ProxyPlugin>(name: string): T | undefined;
}

export interface DebugPlugin extends ProxyPlugin {
  readonly active: boolean;
  readonly fileId?: string;
  startDebug(options?: { fileName?: string; full?: boolean }): void;
  stopDebug(): void;
}

/* ---------- server, sessions, participants ---------- */

export interface ProxyServerConfig {
  /** Port the proxy listens on. Clients/bots connect here. */
  proxyPort?: number;
  /** Whether the local listener requires Microsoft authentication. */
  onlineMode?: boolean;
  /** Upstream server the proxy forwards every connection to. */
  host?: string;
  port?: number;
  /**
   * Protocol version forwarded to `minecraft-data` for the listener defaults
   * (motd/ping). The *actual* per-connection version is always inferred from
   * the client handshake, so this only affects the server list ping.
   */
  fallbackVersion?: string;
  limits?: Partial<ProxyLimits>;
  /** Default for every session. Default: 5 attempts, 5 seconds apart. */
  reconnect?: ProxyReconnectOptions | false;
}

/** What the renderer needs to render the proxy page. */
export interface ProxyInfo {
  sessions: ProxySessionInfo[];
  config: {
    port: number;
    onlineMode: boolean;
  };
}

export interface ProxySessionInfo {
  id: string;
  /** Account the upstream is logged in as. */
  account: string;
  version: string;
  reconnecting?: ProxyReconnectState;
  /** Whether a new client could take over this session now. */
  switching: { supported: boolean; reasons: string[] };
  debugRecording?: string;
  participants: {
    id: string;
    username: string;
    kind: ProxyParticipantKind;
    role: ProxyParticipantRole;
  }[];
}

export interface ProxyServer {
  /** Resolves when the local listener is accepting connections. */
  readonly ready: Promise<void>;
  readonly config: ProxyServerConfig & {
    proxyPort: number;
    host: string;
    port: number;
  };
  readonly sessions: ReadonlyMap<string, ProxySession>;
  readonly pendingAdmissions: number;
  getSession(id: string): ProxySession | undefined;
  getParticipants(): ProxyParticipant[];
  getParticipant(idOrUsername: string): ProxyParticipant | undefined;
  /** Give `target` control of the session it is in. */
  switch(target: ProxyParticipant | string): Promise<ProxyOperationResult<ProxySwitchReceipt>>;
  /**
   * Move a connected participant into another session without disconnecting it,
   * and give it control unless `drive` is false. Needs a 1.20.2+ client.
   */
  move(
    participant: ProxyParticipant | string,
    session: ProxySession | string,
    options?: { drive?: boolean; timeoutMs?: number },
  ): Promise<ProxyOperationResult>;
  tell(target: ProxyParticipant | string, message: string): void;
  broadcast(message: string): void;
  kick(target: ProxyParticipant | string, reason?: string): void;
  /** Handlers run in order; the first decision wins. Default: a new session. */
  onAdmission(handler: ProxyAdmissionHandler): () => void;
  /** Run `handler` in every session's pipeline, current and future. */
  onPacket(events: string | string[], handler: PacketHandler): () => void;
  getInfo(): ProxyInfo;
  stop(): void;
  on(
    event: 'session',
    listener: (action: 'created' | 'ended', session: ProxySession, reason?: string) => void,
  ): this;
  on(
    event: 'participant',
    listener: (
      action: 'attached' | 'detached',
      participant: ProxyParticipant,
      session: ProxySession,
      reason?: string,
    ) => void,
  ): this;
  on(event: 'driver', listener: (event: ProxyDriverEvent & { session: ProxySession }) => void): this;
  on(
    event: 'reconnect',
    listener: (session: ProxySession, state: ProxyReconnectState | undefined) => void,
  ): this;
  on(event: 'packetError', listener: (error: ProxyPacketError) => void): this;
  /** Anything `getInfo()` reports may have changed. Batched per tick. */
  on(event: 'change', listener: () => void): this;
}

export interface ProxyParticipant {
  readonly id: string;
  /** The session it is in. Changes on `server.move`. */
  readonly session?: ProxySession;
  readonly username: string;
  readonly protocol: number | string;
  readonly kind: ProxyParticipantKind;
  readonly role: ProxyParticipantRole;
  /** Protocol phase of this connection: `login`, `configuration` or `play`. */
  readonly phase: string;
  readonly connected: boolean;
  /** Packets of this participant only. Moves with it between sessions. */
  readonly pipeline: PacketPipeline;
  readonly isProviderFresh: boolean;
  /** Whether it can be reconfigured: moved between sessions or kept through a reconnect. */
  readonly canReconfigure: boolean;
  provider?: ProxyStateProvider;
  /**
   * A line kept on screen: the action bar of vanilla clients, the HUD of the
   * JNbot mod. The session sets it while spectating or reconnecting.
   */
  status?: string;
  tell(message: string): void;
  end(reason?: string): void;
  on(event: 'phase', listener: (phase: string) => void): this;
  on(event: 'leave', listener: (reason: string) => void): this;
}

export interface ProxySession {
  readonly id: string;
  readonly server: ProxyServer;
  readonly config: ProxyServerConfig;
  /** Account the upstream is logged in as. */
  readonly account: string;
  readonly version: string;
  readonly protocol: number | string;
  /** Upstream phase: `configuration` or `play` once connected. */
  readonly phase: string;
  readonly isClosed: boolean;
  readonly switchingCapability: {
    supported: boolean;
    reasons: string[];
  };
  readonly participants: ReadonlyMap<string, ProxyParticipant>;
  readonly driver?: ProxyParticipant;
  readonly limits: ProxyLimits;
  readonly pipeline: PacketPipeline;
  readonly pluginManager: PluginManager;
  handback: ProxyHandback;
  reconnect: ProxyReconnectOptions | false;
  readonly reconnecting?: ProxyReconnectState;
  onPacket(events: string | string[], handler: PacketHandler): () => void;
  /** Chat to the driver. */
  tell(message: string): void;
  /** c2s goes upstream as if the driver sent it; s2c to one or every synced participant. */
  write(
    direction: PacketDirection,
    name: string,
    data: ProxyPacketData,
    participantId?: string,
  ): boolean;
  writeRaw(direction: PacketDirection, raw: RawPacket, participantId?: string): boolean;
  /** Bootstrap a `syncing` participant into a spectator without giving it control. */
  sync(participant: ProxyParticipant | string, options?: { timeoutMs?: number }): Promise<ProxyOperationResult>;
  /** Give control to `participant`, bootstrapping it first if needed. Waits for play. */
  switchTo(
    participant: ProxyParticipant | string,
    options?: { timeoutMs?: number },
  ): Promise<ProxyOperationResult<ProxySwitchReceipt>>;
  /**
   * Let a participant that is not driving send these c2s packets to the server,
   * e.g. a frozen bot handling the inventory (`PacketGroups.inventory`) while a
   * player drives. Returns a function that revokes the grant.
   */
  grant(
    participant: ProxyParticipant | string,
    packets: string | readonly string[],
    options?: ProxyGrantOptions,
  ): () => void;
  kick(participantId: string, reason?: string): boolean;
  end(reason?: string): void;
  on(
    event: 'participant',
    listener: (action: 'attached' | 'detached', participant: ProxyParticipant, reason?: string) => void,
  ): this;
  on(event: 'driver', listener: (event: ProxyDriverEvent) => void): this;
  on(event: 'reconnect', listener: (state: ProxyReconnectState | undefined) => void): this;
  on(event: 'packetError', listener: (error: ProxyPacketError) => void): this;
  on(event: 'close', listener: (session: ProxySession, reason: string) => void): this;
}

/** c2s packet names by purpose, across protocol versions. For `session.grant`. */
export type ProxyPacketGroup = 'movement' | 'inventory' | 'interaction' | 'chat';

/* ---------- recordings ---------- */

/**
 * What a recording is for:
 * - `replay`: client->server stream, used to drive a connection (the default).
 * - `debug`: both directions, large packets truncated — for inspection only.
 * Absent on legacy recordings (treat as `replay`).
 */
export type RecordingKind = 'replay' | 'debug';

/** Metadata file written alongside every recording (`<name>.json`). */
export interface RecordingHeader {
  /** stable id == base filename; survives renames of the display `name` */
  id: string;
  name: string;
  /** what the recording is for; absent on legacy recordings (treat as 'replay') */
  kind?: RecordingKind;
  /** recorder format version */
  version: string;
  timestamp: number;
  /** minecraft version the recording was captured on */
  mcVersion: string;
  ignoredPackets: string[];
  packetCount: number;
  /** total duration in ms */
  duration: number;
}

/** One line of the NDJSON `<name>.log` data file. */
export interface RecordingPacket {
  /** packet name */
  n: string;
  /** delta time from recording start, ms */
  dt: number;
  /** packet params */
  p: Record<string, any>;
  /** free-form metadata */
  m: Record<string, any>;
  /** direction; absent on legacy recordings (treat as 'c2s') */
  d?: PacketDirection;
}

/** A pure transform applied to a packet during record or replay. */
export type Transformer = (packet: RecordingPacket) => RecordingPacket | null;
