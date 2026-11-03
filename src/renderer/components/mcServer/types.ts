import type {
  MinecraftBridgeClientSummary,
  MinecraftServerSummary,
  MinecraftWorldInfo,
} from '../../../common/minecraftServers';

export interface CreateServerValues {
  name: string;
  version: string;
  memoryMB: number;
  onlineMode: boolean;
  eulaAccepted: boolean;
  worldPath?: string;
  allowUnknownWorldVersion?: boolean;
}

export interface JoinServerValues {
  invite: string;
}

export interface ShareWorldValues {
  name: string;
  mode: 'client' | 'manual';
  clientId?: string;
  version?: string;
  port?: number;
  cheatsAllowed?: boolean;
}

export interface ServerActions {
  onStart: (server: MinecraftServerSummary) => void;
  onStop: (server: MinecraftServerSummary) => void;
  onCopy: (value: string, label: string) => void;
  onInvite: (server: MinecraftServerSummary, rotate?: boolean) => void;
  onOpen: (server: MinecraftServerSummary) => void;
  onRemove: (server: MinecraftServerSummary) => void;
}

export interface ServerDialogData {
  versions: string[];
  worlds: MinecraftWorldInfo[];
  bridgeClients: MinecraftBridgeClientSummary[];
}
