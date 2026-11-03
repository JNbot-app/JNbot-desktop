export interface BotInfo {
  botId: number;
  username: string;
  SCRIPT_NAME: string;
  SCRIPT_ID: string;
  host: string;
  version: string;
  UID?: string;
  // botInfo: {
  //   version: string;
  // };
}

export interface InfoData {
  gamemode?: string;
  health?: number;
  hunger?: number;
  position?: {
    x: number;
    y: number;
    z: number;
  };
  xp?: number;
  level?: number;
  xpProgress?: number;
  uuid?: string;
  ping?: number;
}

export interface ChatClick {
  action: 'run_command' | 'suggest_command' | 'open_url' | 'copy_to_clipboard' | 'change_page';
  value: string;
}

export interface ChatPart {
  text: string;
  click?: ChatClick;
  hover?: string;
}

/** Plain ANSI string, or an object with parts when the line has click/hover events. */
export type ChatLine = string | { message: string; parts: ChatPart[] };

export type ChatData =
  | { messages: ChatLine[] }
  | { message: string; parts?: ChatPart[] };

export interface MovementData {
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
  fly: boolean;
  left: boolean;
  right: boolean;
  forward: boolean;
  back: boolean;
  isPathfinding: boolean;
  pitch: number;
  yaw: number;
}

export interface InventoryData {
  hotbar?: number;
}

export interface ActionsData {
  eating: boolean;
}

export interface MapData {
  botPos: { x: number; y: number; z: number };
  chunkUpdates: ChunkUpdate[];
}

export type ChunkUpdate = {
  type: "load";
  x: number;
  z: number;
  chunk: number[];
} | {
  type: "unload";
  x: number;
  z: number;
};

export interface TabData {
  info?: InfoData;
  chat?: ChatData;
  movement?: MovementData;
  inventory?: InventoryData;
  actions?: ActionsData;
  map?: MapData;
}

export interface TabRef {
  update: (data: any) => void;
}

export type TabKey = 'info' | 'chat' | 'actions' | 'inventory' | 'movement' | 'triggers' | 'map' | 'code';
