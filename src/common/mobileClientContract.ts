/**
 * Platform-neutral contract consumed by the mobile client.
 *
 * Keep this module free of desktop-only imports so it can be vendored into the
 * React Native project together with the Messenger implementation.
 */
import type { WeeklySeries } from './statsHistory';

export const MOBILE_CLIENT_CONTRACT_VERSION = 1 as const;
export const REMOTE_PROTOCOL_VERSION = 1 as const;

export const CLIENT_CAPABILITIES = [
  'instance.direct-transfer',
  'profiles',
  'scripts',
  'plugins',
  'bot-chat',
  'bot-inventory',
  'alts.manage',
  'bot-actions',
  'bot-movement',
  'bot-info',
  'profiles.local-catalog',
  'profiles.portable-sync',
  'plugins.portable-sync',
] as const;

export type ClientCapability = (typeof CLIENT_CAPABILITIES)[number];

export type InstanceTransferManifest = {
  transferId: string;
  formatVersion: 1;
  byteCount: number;
  chunkCount: number;
  chunkSize: number;
  sha256: string;
  createdAt: number;
  expiresAt: number;
};

export type InstanceTransferRequestResult =
  | { status: 'approved'; manifest: InstanceTransferManifest }
  | { status: 'denied' | 'cancelled' | 'expired'; error?: string };

export type InstanceTransferChunk = {
  transferId: string;
  index: number;
  data: string;
  sha256: string;
};

export const PROFILE_ACTIONS = [
  'SCRIPT_PROGRESS',
  'STOP',
  'STOP_ALL',
  'START_SCRIPT',
  'RESTART_ALL',
  'SCRIPT_CONTROL',
  'OPEN_CONSOLE_LOGS',
  'GET_LOGS',
  'CLEAR_CONSOLE',
  'SERVER_STATUS_UPDATE',
  'SERVER_STATUS',
  'GET_SCRIPT_ACTIONS',
  'DELETE_MACRO',
  'UPDATE_PLUGIN_DATA',
  'SET_SETTINGS',
  'SETTINGS_UPDATE',
  'SET_APPSETTINGS',
  'APPSETTINGS_UPDATE',
  'ALT_UPDATE',
  'ALT_UPSERT',
  'ALT_DELETE',
  'BOT_ACTION',
  'LAUNCH_MINECRAFT',
  'MC_LOGIN_MICROSOFT',
  'MC_LOGOUT_MICROSOFT',
  'ALTS_OF_PROFILE',
  'IMPORT_ALTS_FROM_PROFILE',
  'RESOLVE_PROFILE_SCRIPT_INFO',
  'RESOLVE_PLUGIN_RUN_DESCRIPTOR',
  'EXPORT_PORTABLE_PROFILE',
] as const;

export type ProfileAction = (typeof PROFILE_ACTIONS)[number];
export type ProfileActionMap = Record<ProfileAction, unknown>;

/**
 * Complete, transport-neutral profile copy used by mobile offline sync.
 * Generic payload members keep this vendored contract independent from the
 * desktop application's domain modules.
 */
export type SyncedProfilePackage<
  Profile = unknown,
  Settings = unknown,
  AppSettings = unknown,
  Alts = unknown,
> = {
  version: 1;
  source: {
    ownerId: string;
    profileKey: string;
  };
  revision: string;
  exportedAt: number;
  profile: Profile;
  settings: Settings;
  appSettings: AppSettings;
  alts: Alts;
};

/**
 * Transport-neutral plugin copy. The payload deliberately contains no
 * profile settings: plugin options can include passwords and other secrets.
 */
export type PortablePluginPackage<
  Info = unknown,
  Code = unknown,
  Signature = unknown,
> = {
  version: 1;
  source: { ownerId: string; pluginId: string };
  revision: string;
  exportedAt: number;
  bundle: {
    format?: 'jnbot-plugin';
    version?: 2;
    info: Info;
    code: Code;
    signature?: Signature;
  };
};

export type PluginImportDecision = {
  ownerId: string;
  pluginId: string;
  revision: string;
  action: 'replace' | 'keep-both' | 'skip';
  acceptUnverified: boolean;
};

export type PluginImportPreview<Package = PortablePluginPackage> = {
  package: Package;
  state: 'new' | 'identical' | 'conflict' | 'unsupported' | 'invalid';
  verification: 'trusted' | 'valid-untrusted' | 'unsigned' | 'invalid';
  publisherName?: string;
  fingerprint?: string;
  reason?: string;
};

export type PluginImportResult = {
  installed: Array<{
    sourcePluginId: string;
    installedPluginId: string;
    outcome: 'installed' | 'replaced' | 'duplicated';
  }>;
  skipped: Array<{ pluginId: string; reason: string }>;
  failed: Array<{ pluginId: string; error: string }>;
};

export const PROFILE_PUBLICATIONS = [
  'settings',
  'appSettings',
  'activeScripts',
  'activeBots',
  'alts',
  'ACTIVE_ACTION_SCRIPT',
  'PROGRESS_UPDATE',
  'SERVER_STATUS',
  'LOGS',
  'snackbar',
  'notification',
  'bot-kicked',
  'macro-prompt',
  'DIALOG',
  'popup-buttons',
  'altUpdateRequest',
  'option-error',
  'mobileActivity',
  'MC_MICROSOFT_DEVICE_CODE',
] as const;

export type ProfilePublicationEvent = (typeof PROFILE_PUBLICATIONS)[number];

export const BOT_ACTIONS = [
  'chatMessage',
  'chatPacket',
  'tabComplete',
  'sendInventoryPacket',
  'inventoryClick',
  'closeWindow',
  'updateSign',
  'dialogAction',
  'closePrompt',
  'renameItem',
  'setHotbar',
  'joinGamemode',
  'runScriptAction',
  'login',
  'eat',
  'activateItem',
  'mouse',
  'movementPacket',
  'toggleMovement',
  'stopMovement',
  'setHeadRotation',
  'startPathFinder',
  'infoPacket',
  'getChunkDump',
  'triggersPacket',
  'testTrigger',
  'leave',
] as const;

export type BotAction = (typeof BOT_ACTIONS)[number];
export type BotActionMap = Record<BotAction, readonly unknown[]>;

export type SettingsPatch = {
  path: readonly string[];
  value?: unknown;
  remove?: boolean;
};

export type AppSettingsPatch = {
  key: string;
  value: unknown;
};

export type ProfileScriptReference = {
  id: string;
};

export type MicrosoftDeviceCodePayload = {
  message?: string;
  userCode: string;
  verificationUri: string;
  expiresIn?: number;
  username?: string;
};

export type AltImportInput = {
  sourceProfileKey: string;
  usernames: string[];
};

export type AltImportResult<Alts = unknown> = {
  added: number;
  updated: number;
  skipped: Array<{ username: string; reason: string }>;
  alts: Alts;
};

/** Compact lifetime totals published to mobile instead of the full stats DB. */
export type MobileActivityStats = {
  botsJoined: number;
  scriptsStarted: number;
  onlineTime: number;
  /** Weekly totals, see common/statsHistory. */
  history?: {
    botsJoined?: WeeklySeries;
    scriptsStarted?: WeeklySeries;
    onlineTime?: WeeklySeries;
  };
};

export type ConsoleLogValue =
  | string
  | number
  | boolean
  | null
  | ConsoleLogValue[]
  | { [key: string]: ConsoleLogValue };

export type ConsoleLogEntry = [
  message: ConsoleLogValue,
  level: 0 | 1 | 2 | 3,
  scriptName: string,
  scriptId: string,
  timestamp: number,
];

export type ConsoleSnapshot = {
  scripts: Record<string, unknown>;
  logs: ConsoleLogEntry[];
};

export type SnackbarPayload = {
  title: string;
  variant?: 'success' | 'error' | 'warning' | 'info' | string;
};

/** A shortcut shown on a notification; each client decides how to open it. */
export type NotificationButton =
  | { label: string; action: 'openBot'; botId: number }
  | { label: string; action: 'openSettings'; tab?: 'storage' };

export type NotificationPayload = {
  title: string;
  message?: string;
  type?: 'success' | 'error' | 'warning' | 'info' | string;
  buttons?: NotificationButton[];
};

export type BotKickedPayload = {
  username: string;
  reason: string;
  scriptName: string;
  scriptId: string;
  botId: number;
};

export type ScriptPromptPayload = {
  title?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  description?: string;
  promptID: string;
  messageAddress: number;
  scriptInstance?: string;
  scriptId?: string;
  instanceId?: number;
};

export type ScriptDialogPayload = {
  id: string | number;
  title: string;
  body?: string;
  buttons: Array<{
    label: string;
    type?: 'default' | 'primary' | 'dashed' | 'link' | 'text' | string;
  }>;
  messageAddress: number;
  script?: string;
  instanceId?: number;
};

export type ScriptButtonPopupPayload = {
  title: string;
  body?: string;
  popupID: string | number;
  buttons?: Array<{ label: string; id: string; variant?: string }>;
  messageAddress: number;
};

export type AltUpdateData = {
  password?: string;
  ranks?: Record<string, string | null>;
  gkits?: Record<string, string[]>;
};

export type AltUpdateRequestPayload = {
  id: string;
  scriptName: string;
  scriptId?: string;
  updates: Record<string, AltUpdateData | null>;
};

export type OptionErrorPayload = {
  pluginId?: string;
  scriptName?: string;
  field: string;
  message: string;
};

export type ScriptUiPublicationMap = {
  LOGS: ConsoleLogEntry[];
  snackbar: SnackbarPayload;
  notification: NotificationPayload;
  'bot-kicked': BotKickedPayload;
  'macro-prompt': ScriptPromptPayload;
  DIALOG: ScriptDialogPayload;
  'popup-buttons': ScriptButtonPopupPayload;
  altUpdateRequest: AltUpdateRequestPayload;
  'option-error': OptionErrorPayload;
  MC_MICROSOFT_DEVICE_CODE: MicrosoftDeviceCodePayload;
};

export type ProfileSnapshot<
  Settings = unknown,
  AppSettings = unknown,
  ActiveScripts = unknown,
  ActiveBots = unknown,
  ActiveActions = unknown,
  Alts = unknown,
  Stats = unknown,
> = {
  profileId: number;
  profileKey: string;
  settings: Settings;
  appSettings: AppSettings;
  activeScripts: ActiveScripts;
  activeBots: ActiveBots;
  activeScriptActions: ActiveActions;
  alts: Alts;
  stats: Stats;
  progress: Record<number, unknown>;
  serverStatus: { ips: string[] };
};

export type ProfilePublicationMap<
  Settings = unknown,
  AppSettings = unknown,
  ActiveScripts = unknown,
  ActiveBots = unknown,
  Alts = unknown,
  ActiveActions = unknown,
  Activity = unknown,
> = {
  settings: Settings;
  appSettings: AppSettings;
  activeScripts: ActiveScripts;
  activeBots: ActiveBots;
  alts: Alts;
  ACTIVE_ACTION_SCRIPT: ActiveActions;
  mobileActivity: Activity;
  PROGRESS_UPDATE: Record<number, unknown>;
  SERVER_STATUS: { ips: string[] };
} & ScriptUiPublicationMap;

export type TypedProfilePublication<Map extends Record<string, unknown>> = {
  [Event in keyof Map & string]: {
    profileId: number;
    event: Event;
    data: Map[Event];
  };
}[keyof Map & string];

export type ProfileCreationSection = 'identity' | 'connection' | 'gamemodes' | 'ranks' | 'scripts' | 'botExtension' | 'defaults';

export type ProfileJoinBehaviour =
  | { kind: 'auto' | 'direct' }
  | { kind: 'command'; command: string }
  | { kind: 'selector'; hotbarSlot: number; pick: 'name' | 'slot'; staticSlot?: number };

export type ProfilePluginReference = {
  id: string;
  pluginId: string;
  source: { kind: 'plugin'; pluginId: string };
  order?: number;
  hidden?: boolean;
};

export type ProfileCreationDefaults = {
  version?: string;
  ip?: string;
  port?: number;
  serverIpRotation?: boolean;
  retryOnLoginFail?: boolean;
  joinServerTimeout?: number;
  auto_v4guard?: boolean;
  autoResourcePackAccept?: boolean;
  kickBehaviour?: { defaultAction: 0 | 1 | 2; rules: { id: string; kickMessage: string; action: 0 | 1 | 2 }[] };
  proxy?: { enabled: boolean; urls: string[] };
  join_delay?: number;
  join_delay_premium?: number;
  delay_between_actions?: number;
};

export type ProfileCreationAdvanced = {
  shortName?: string;
  icon?: string | null;
  color?: string;
  ips?: string[];
  gamemodes?: string[];
  kitGamemodes?: string[];
  defaultGamemode?: string;
  joinBehaviours?: Record<string, ProfileJoinBehaviour>;
  ranksGkits?: Record<string, { ranks: Record<string, { price: number; color: string }>; gkits: Record<string, number> }>;
  scripts?: ProfilePluginReference[];
  disallowedPlugins?: string[];
  botExtensionAction?: ProfilePluginReference;
  appSettingsDefaults?: ProfileCreationDefaults;
};

export type CreateProfileInput = {
  name: string;
  host: string;
  port: number;
  onlineMode: boolean;
  advanced?: ProfileCreationAdvanced;
};
