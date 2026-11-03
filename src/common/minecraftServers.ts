export type MinecraftServerRole = 'host' | 'joined';
export type MinecraftServerSource = 'dedicated' | 'client-lan' | 'manual-lan';
export type MinecraftServerState =
  | 'installing'
  | 'stopped'
  | 'starting'
  | 'online'
  | 'stopping'
  | 'offline'
  | 'error';
export type MinecraftServerApiState =
  | 'unsupported'
  | 'offline'
  | 'connecting'
  | 'online'
  | 'error';

export interface MinecraftWorldInfo {
  path: string;
  name: string;
  version?: string;
  lastPlayed?: number;
  iconPath?: string;
}

export interface MinecraftBridgeClientSummary {
  clientId: string;
  username?: string;
  mcVersion?: string;
  instanceId?: string;
}

export interface MinecraftServerSummary {
  id: string;
  name: string;
  version: string;
  role: MinecraftServerRole;
  source: MinecraftServerSource;
  state: MinecraftServerState;
  localAddress?: string;
  peerCount: number;
  progress?: { label: string; current?: number; total?: number };
  error?: string;
  onlineMode?: boolean;
  memoryMB?: number;
  createdAt: number;
  apiState: MinecraftServerApiState;
  apiVersion?: string;
  restartRequired: boolean;
  pluginCount: number;
}

export interface MinecraftServerDetail extends MinecraftServerSummary {
  capabilities: {
    console: boolean;
    plugins: boolean;
    api: boolean;
  };
}

export type MinecraftServerPluginChange = 'install' | 'update' | 'remove';

export interface MinecraftServerPluginDependency {
  projectId: string;
  versionId: string;
  name: string;
}

export interface MinecraftServerPlugin {
  projectId: string;
  versionId: string;
  name: string;
  description?: string;
  versionNumber: string;
  filename: string;
  iconUrl?: string;
  installed: boolean;
  dependency: boolean;
  pendingChange?: MinecraftServerPluginChange;
  updateVersionId?: string;
  updateVersionNumber?: string;
  dependencies: MinecraftServerPluginDependency[];
}

export interface MinecraftServerPluginSearchHit {
  projectId: string;
  slug: string;
  name: string;
  description: string;
  iconUrl?: string;
  author: string;
  downloads: number;
  versions: string[];
}

export interface MinecraftServerPluginSearchPage {
  hits: MinecraftServerPluginSearchHit[];
  offset: number;
  limit: number;
  total: number;
}

export interface MinecraftServerPluginVersion {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  versionType: 'release' | 'beta' | 'alpha';
  publishedAt: string;
  dependencies: Array<{
    projectId?: string;
    versionId?: string;
    type: 'required' | 'optional' | 'incompatible' | 'embedded';
  }>;
}

export interface MinecraftServerPluginProject {
  projectId: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  iconUrl?: string;
  author?: string;
  downloads: number;
  versions: MinecraftServerPluginVersion[];
}

export interface McServerHandleSummary {
  id: string;
  name: string;
  version: string;
  state: MinecraftServerState;
  apiState: MinecraftServerApiState;
}

export interface McServerApiStatus extends McServerHandleSummary {
  apiVersion?: string;
  players: number;
  uptimeMs?: number;
}

export interface McServerPlayer {
  uuid: string;
  name: string;
  displayName?: string;
  gameMode?: string;
  dimension?: string;
  position?: { x: number; y: number; z: number };
  latency?: number;
}

export interface McServerWorldSummary {
  id: string;
  name: string;
}

export interface McServerWorldInfo extends McServerWorldSummary {
  time: number;
  timeOfDay: number;
  difficulty?: string;
  raining: boolean;
  thundering: boolean;
  spawn?: { x: number; y: number; z: number };
  players: number;
}

export interface McServerApiList {
  methods: string[];
  events: string[];
}

export interface McServerApiVersion {
  protocol: number;
  api: string;
  minecraft: string;
  mod?: string;
}

export interface McServerApiCapabilities {
  methods: string[];
  events: string[];
}

export interface McServerEventPayloads {
  stateChanged: {
    previous: MinecraftServerState;
    state: MinecraftServerState;
  };
  started: { ts: number };
  stopping: { ts: number };
  playerJoin: { player: McServerPlayer; ts: number };
  playerLeave: { player: McServerPlayer; reason?: string; ts: number };
  chat: { player: McServerPlayer; message: string; ts: number };
}

export type McServerEventName = keyof McServerEventPayloads;

export interface IMcServer {
  readonly id: string;
  getStatus(): Promise<McServerApiStatus>;
  executeCommand(command: string): Promise<{
    result: number;
    output: readonly string[];
  }>;
  broadcast(message: string): Promise<void>;
  getPlayers(): Promise<readonly McServerPlayer[]>;
  getPlayer(nameOrUuid: string): Promise<McServerPlayer | null>;
  sendMessage(nameOrUuid: string, message: string): Promise<void>;
  kickPlayer(nameOrUuid: string, reason?: string): Promise<void>;
  getWorlds(): Promise<readonly McServerWorldSummary[]>;
  getWorldInfo(dimension?: string): Promise<McServerWorldInfo>;
  apiList(): Promise<McServerApiList>;
  apiVersion(): Promise<McServerApiVersion>;
  apiCapabilities(): Promise<McServerApiCapabilities>;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  on<E extends McServerEventName>(
    event: E,
    handler: (data: McServerEventPayloads[E]) => void,
  ): Promise<() => void>;
}

export interface CreateMinecraftServerInput {
  name: string;
  version: string;
  memoryMB?: number;
  onlineMode?: boolean;
  eulaAccepted: boolean;
  world?: MinecraftWorldInfo;
  allowUnknownWorldVersion?: boolean;
}

export interface ShareMinecraftClientWorldInput {
  name: string;
  clientId: string;
  version?: string;
  cheatsAllowed?: boolean;
}

export interface ShareMinecraftLanInput {
  name: string;
  version: string;
  port: number;
}

export interface MinecraftServerInvite {
  v: 1;
  r: string;
  k: string;
  n: string;
  m: string;
}

export const MINECRAFT_SERVER_INVITE_PREFIX = 'jnbot-mc:v1:';
