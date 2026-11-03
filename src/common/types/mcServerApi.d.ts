

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