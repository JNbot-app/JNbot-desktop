import type { Worker } from 'worker_threads';
import type { BrowserWindow } from 'electron';
import type Statistics from './functions/Stats';
import type { WeeklySeries } from '../../common/statsHistory';
import type { Socket } from './functions/peer2peer/Socket';
import type Console from './functions/Console';
import type ScriptHandler_ from './functions/ScriptHandler';
import type ProfileRuntime from './functions/ProfileRuntime';
import type ActiveScripts_ from './functions/ActiveScripts';
import type Script_ from './functions/Script';
import type Settings_ from './functions/Settings';
import type { ServerTypes as JNbotServerTypes } from './functions/peer2peer/DeviceHandler';
import type WebRTC_nodejs from '../../common/WebRTC_nodejs';
import type { ScriptThemeType } from '../../renderer/components/macros/types';
import type { PluginOptionSchema } from '../../common/pluginOptions';
import type EventEmitter from 'node:events';
import type ClientEvents_ from './functions/ClientEvents';
import type { RecipeDocumentV3 } from '../../common/recipeV3';
import type { Trigger } from '../../common/triggers';
export type { Trigger };
import type {
  KickBehaviorOptions,
  LogStatus,
  MinecraftLauncherTypes,
  Themes,
  UpdateState,
} from '../../common/CommonEnums';
import type WindowHandler_ from './functions/WindowHandler';
import type { BaseButtonProps } from 'antd/es/button/Button';
import { ProfileScript, ProfileScriptList } from '../../common/profileScripts';
import type Profiles_ from './functions/Profiles';
import type { ClientPermissions } from '../../common/clientPermissions';
import type { ConsoleLogValue } from '../../common/mobileClientContract';
import type { PluginProvenance, PluginSignatureV2 } from './functions/signing';
import { AutomationDocument } from 'common/automation';

export type consoleType = 'macro' | 'console' | 'macro_console';

export type NodeErrorDetails = {
  source: string;
  message: string;
  stack?: string;
  script?: string;
  instanceId?: number;
  exitCode?: number;
};

declare global {
  namespace NodeJS {
    interface Process {
      emit(event: 'jnbot-mobile-error', details: NodeErrorDetails): boolean;
      on(event: 'jnbot-mobile-error', listener: (details: NodeErrorDetails) => void): this;
    }
    interface Global {
      send: (action: string, data?: unknown, socket?: unknown) => void;
    }
  }
  var send: (
    action: string,
    data?: unknown,
    socket?: unknown,
  ) => void;
  function broadcast(event: string, data?: unknown): void;
  var isMobileRuntime: boolean;
  var isCLI: boolean;
}

declare module 'minecraft-protocol' {
  interface Client {
    removeAllListeners(event?: string | symbol): this;
    supportFeature?(feature: string): boolean;
  }
}

export interface ActiveAction {
  action: string;
  instanceId: number;
  actionId: string;
}

export interface ScriptSettings {
  script: string;
  arguments?: any;
  scriptName: string;
  console?: consoleType;
  scriptId: string;
}

export interface ScriptOptions {
  customSettings?: WorkerSettings;
}

export interface BotInfo {
  botId: number;
  username: string;
  script: string;
  id: string;
  version: string;
  uuid: string | undefined;
  UID?: string;
  host: string;
  port: number;
  status: 'queued' | 'joining' | 'connected' | 'failed';
  /** Expected connection start time while this bot is waiting for join spacing. */
  joinAt?: number;
  paused: boolean;
  /** "worker" = normal JNbot worker bot, "minecraft" = live Minecraft client/session (no worker). */
  origin?: 'worker' | 'minecraft';
  /** Run-local messaging identity for normal worker bots. */
  RUNTIME_PROFILE_ID?: number;
  RUNTIME_SCRIPT_ID?: number;
  MESSAGE_ADDRESS?: number;
}

export type ActiveBotsType = ({
  SCRIPT_NAME: string;
  SCRIPT_ID: string;
  INSTANCE_ID: string;
  /** New messaging identity fields; legacy fields remain during migration. */
  PLUGIN_ID?: string;
  RUNTIME_PROFILE_ID?: number;
  RUNTIME_SCRIPT_ID?: number;
  MESSAGE_ADDRESS?: number;
} & BotInfo)[];

export interface Origin {
  sockets: boolean;
  socket: Socket | null;
  /**
   * Reply to the client that sent this message, on `channel`. Both transports
   * provide it: Electron's `IpcMainEvent` has it natively, and the socket
   * bridge injects an equivalent (see `ClientEvents.registerSocket`). This is
   * what lets `ipcMain.on(ch, (e) => e.reply(...))` request/reply handlers
   * serve remote (web/p2p) clients exactly like the local window. Optional so
   * the plain `{ sockets, socket }` origin literals used for broadcasts stay
   * valid.
   */
  reply?: (channel: string, data?: unknown) => void;
}

export interface ServerStats {
  accountWorth: number;
}

/**
 * Per-server stats sit alongside `alts` and `scripts` as dynamic keys
 * (one entry per server id from JNdata.serverList).
 */
export interface Stats {
  alts: {
    [username: string]: {
      joinCount: number;
      lastJoined: number | null;
      playTime: number;
      createdOn: number;
    };
  };
  scripts: {
    [scriptName: string]: {
      activeCount: number;
      lastActive: number | null;
      runTime: number;
    };
  };
  /** Weekly totals across all alts/scripts, see common/statsHistory. */
  history?: {
    botsJoined?: WeeklySeries;
    scriptsStarted?: WeeklySeries;
    onlineTime?: WeeklySeries;
  };
  [serverId: string]: any; // ServerStats by server id; alts/scripts handled above
}

export class Script extends BotEvents {
  name: string;
  id: string;
  worker: Worker;
  scriptSettings: ScriptSettings;
  activeScripts: ActiveScripts_;
  options: { waitBeforeTerminate: boolean };
  scriptHandler: ScriptHandler;
  console: Console;
  constructor(
    scriptSettings: ScriptSettings,
    scriptHandler: ScriptHandler,
    scriptOptions: { instanceId: number },
  );
  run(): void;
  stop(): void;
  restart(fast?: boolean): void;
  send(event: string, data: any): void;
  eventHandler(): void;
  toString(): string;
  updateProgress(progress: { current: number; total: number }): void;
}

type Gamemode = string;

export interface Progress {
  current: number;
  total: number;
  /** Estimated seconds remaining, derived from the mean time per iteration. */
  eta?: number;
}

export interface ExtendedProgress extends Progress {
  instanceId: number;
}

export class Bot {
  botInfo: BotInfo;
  script: Script;
  constructor(botInfo: BotInfo, script: Script);

  send(event: string, data?: any): void;
}

export class ActiveBots {
  bots: { [username: string]: Bot };
  settings: Settings;

  constructor(mainWindow: BrowserWindow);
  addBot(botInfo: BotInfo, script: Script_): void;
  removeBot(botInfo: { username: string; send?: boolean }): void;
  toArray(): BotInfo[];
  removeBotByScript(script: Script): void;
  send(): void;
}

export type ServerAltInfo = {
  /** Whether this alt uses Microsoft authentication on this profile. */
  premium?: boolean;
  password?: string;
  gkits: { [gamemode: string]: string[] };
  ranks: { [gamemode: string]: string };
};

/**
 * An alt. Identity only — username, UID, email — shared across every server.
 * Per-server authentication mode, credentials/ranks/gkits live in
 * `SettingsObj.altData` of the corresponding server file. Merge the two
 * sides with `AltWithData` for in-memory use.
 */
export interface Alt {
  username: string;
  UID?: string | null;
  /** @deprecated - No longer used */
  email?: string;
}

/**
 * Alt merged with the active server's `ServerAltInfo`. This is what UI,
 * workers, and IPC payloads pass around. An alt with no `data` for the
 * active server should be treated as "not used on this server".
 */
export type AltWithData = Alt & { data: ServerAltInfo };

export interface AltWithSession extends Alt {
  /**
   * Minecraft access token + basic profile used for launching and skins.
   * Tokens themselves live in the shared prismarine-auth cache (keyed per
   * username) and are refreshed transparently — this is just the resolved
   * session for the current launch.
   */
  minecraftSession?: {
    accessToken: string;
    uuid: string;
    name: string;
    skinUrl?: string;
  };
}

/**
 * Built-in server identifiers. Additional servers can still be added at
 * runtime through JNdata.serverList — UI code should iterate that list and
 * cast to ServerTypes on assignment when needed. The string fallback covers
 * user-defined profiles.
 */
export type ServerTypes = 'jartexnetwork' | 'pikanetwork' | (string & {});

type AppSettingOption = Partial<
  Record<string, unknown> & {
    server: ServerTypes;
    ip: string;
    port: number;
    /**
     * Getting-started checklist shown after the intro: ids of the completed
     * steps. Unset (or null once dismissed) hides the checklist.
     */
    gettingStarted?: string[] | null;
    kickBehaviour?: KickBehaviorConfig;
    allowPrereleaseUpdates?: boolean;
    logging_dir?: string;
    join_delay?: number;
    logs_webhook?: string;
    proxy?: ProxyConfig;
    /**
     * Command used to open a plugin in the user's preferred external editor
     * (e.g. "code"). Empty/unset falls back to the OS default app for the
     * file. See `OPEN_PLUGIN_EXTERNAL` in ClientEvents.
     */
    pluginEditorCommand?: string;
    /**
     * When enabled, prevents the OS from sleeping/suspending while the app is
     * running. Applied in the main process via Electron's powerSaveBlocker.
     */
    preventSleep?: boolean;

    /** Install updates of marketplace shares automatically (default on). */
    autoUpdateShares?: boolean;

    /** Whether UI animations and transitions should be disabled across the app. */
    reduceMotion?: boolean;

    /** Whether the primary application sidebar is collapsed. */
    sidebarCollapsed?: boolean;

    theme: Themes;
    worker_optimize_for_size?: boolean;
    render_distance?: number;
    reduced_events?: boolean;
    captcha_prompt?: boolean;
  }
>;

export interface ProxyConfig {
  enabled: boolean;
  /** e.g. socks5://user:pass@host:1080 or socks4://host:port */
  urls: string[];
}

export type AppSettings = AppSettingOption;

export type { Reminder } from '../../common/cooldowns';
import type { Reminder } from '../../common/cooldowns';

export interface Device {
  name: string;
  id: string;
  token: string;
  permissions: ClientPermissions;
  createdAt?: number;
  lastActivityAt?: number;
}

export type JNbotServerStatus = {
  devices: DeviceObj[];
  peer2peer: {
    status: boolean;
    url?: string;
    room?: string;
  };
};

export interface DeviceObj extends Device {
  status: number; // 0 = CONNECTED, 1 = CONNECTING, 2 = DISCONNECTED
  server: JNbotServerTypes | null;
  connectionCount: number;
}

export type LaunchMinecraftOptions = {
  username: string;
  version: string;
  /** Optional custom Minecraft root directory (e.g. an existing .minecraft). */
  minecraftDirectory?: string;
  /**
   * Internal: Correlates a launch request and process with UI and WS bridge events.
   * The renderer may provide a UUID; other callers can omit it and let the main process create one.
   */
  bridgeInstanceId?: string;
  minMemoryMB?: number;
  maxMemoryMB?: number;
  launcherFlags?: MinecraftLauncherTypes;
  forge?: string;
  window?: {
    fullscreen?: boolean;
    width?: number;
    height?: number;
  };

  gamemode: Gamemode | null;
  extraJvmArgs?: string;
  /** Server to join on start (`host:port`). Default: the profile's server. */
  server?: string;
};

export type ScriptSettingsSection = {
  chains?: Record<string, Chain>;
} & Record<string, any>;

export type PluginData = {
  [pluginId: string]: {
    pinned: boolean;
  };
};

/** Local-library metadata shared by every server profile. */
export type PluginMetadata = Record<
  string,
  {
    folder?: string;
  }
>;

/**
 * Per-server settings. One file on disk per server id (servers/<id>.json),
 * only the active server is held in memory / synced over IPC.
 */
export interface SettingsObj {
  scripts: ScriptSettingsSection;
  pluginData: PluginData; // Active-profile plugin state, such as pinned plugins.
  reminders: Reminder[];
  triggers: Trigger[];
  altTags: AltTag[];
  altData: { [username: string]: ServerAltInfo };
  /** Schema version for this server file. */
  version: number;
}

export interface SettingsPatch {
  path: Array<string | number>;
  value?: unknown;
  remove?: boolean;
}

export interface WorkerSettingsUpdate {
  alts?: AltWithData[];
}

/**
 * Cross-server settings — kept in shared.json. Sent over its own IPC channel
 * so it doesn't bloat per-server `settings-update` payloads.
 */
export interface SharedSettings {
  alts: Alt[];
  devices: Device[];
  /** Local plugin-library metadata; intentionally separate from plugin info. */
  pluginMetadata: PluginMetadata;
  launcherOptions?: LaunchMinecraftOptions;
  /** Schema version for shared.json. */
  version: number;
}

/**
 * Renderer-owned fields that may be changed through the shared-settings IPC
 * channel. Access-link credentials remain owned by the main process.
 */
export type SharedSettingsUpdate = Partial<Pick<
  SharedSettings,
  'alts' | 'pluginMetadata' | 'launcherOptions'
>>;

/**
 * A user-defined grouping of alts. Tags are scoped to a specific server id
 * (e.g. "jartexnetwork") and contain an ordered list of alt usernames.
 * The order in `alts` is meaningful — features like gkit collection iterate
 * it in sequence.
 */
export interface AltTag {
  id: string;
  name: string;
  color: string;
  alts: string[];
}

import type { Chain } from '../../common/chains';
export type { Chain, ChainOptions, ChainStep } from '../../common/chains';


export class Settings extends EventEmitter {
  shared: SharedSettings;
  /** Shared app settings only. Use getProfileAppSettings(profileKey) for a profile. */
  appSettings: AppSettings;
  JNdata: JNdata;
  stats: Statistics;
  profiles: Profiles_;
  /** Startup fallback used only by legacy CLI paths. */
  bootstrapProfileKey: string;

  constructor();
  activateProfile(profileKey: string): void;
  updateProfileSettings(
    profileKey: string,
    patches: SettingsPatch | SettingsPatch[],
  ): SettingsObj;
  updateShared(
    update: SharedSettingsUpdate,
    updateClient: boolean,
    origin?: Origin,
  ): void;
  setProfileAppSetting(
    profileKey: string,
    key: string,
    value: unknown,
  ): AppSettings;
  setSharedAppSetting(key: string, value: unknown): AppSettings;
  sendShared(socket?: Socket): void;
  sendAppSettings(socket?: Socket): void;
  sendJNdata(socket?: Socket): void;
  removeDevice(deviceId: string): void;
  updateDevice(deviceId: string, device: Device): void;
}

/**
 * Settings shape exposed to workers — the active server's per-server file
 * merged with the shared fields a worker actually reads (alts, devices,
 * launcherOptions). Built in Script.ts before spawning the worker.
 */
export type WorkerSettings = SettingsObj & {
  alts: AltWithData[];
  devices: Device[];
  launcherOptions?: LaunchMinecraftOptions;
};

export type WorkerDataType = {
  scriptName: string;
  script: string;
  id: string;
  /** Stable plugin identifier. */
  pluginId: string;
  /** @deprecated Use pluginId. */
  scriptId: string;
  instanceId: number; // unique id for this script run, used for creating bot ids
  /** New run-local routing identity. `instanceId` remains during migration. */
  messaging: {
    address: number;
    profileId: number;
    scriptId: number;
  };
  data: any;
  execArgv: string[];
  sharedArray: Uint16Array;
  settings: SettingsObj;
  sharedSettings: SharedSettings;
  appSettings: AppSettings;
  profile: ActiveProfileObj | null;
  scriptOptions: {
    startTime: number;
    ips: string[]; // Replace 'any' with the actual type if known
    disableConsolePrints: boolean;
  };
  paths: {
    plugins: string;
    recordings: string;
    /** Brain recordings and models (`require('JNbot').Brain`). */
    ai: string;
    /** Shared prismarine-auth cache dir (per-username) for premium bot logins. */
    minecraftAuth: string;
  };
  actions: MacroInfo[];
  startCount?: number;
  /**
   * Resolved code and metadata for this runtime profile's `botExtensionAction`,
   * if any. Pre-resolved by `Script.ts` so the worker doesn't have to
   * round-trip through IPC to load the user's bot extension. See
   * `join.js` for the load site.
   */
  botExtension?: { code: string; info: MacroInfo };
  /** Resolved join actions, keyed by `gamemodeKey` (join method `action`). */
  joinActions?: Record<string, { code: string; info: MacroInfo }>;
  appVersion: string;
  isMobileRuntime: boolean;
  /**
   * Internal-only adapter used by the loopback protocol harness. It never
   * appears in normal Script worker data and keeps plugin HTTP deterministic.
   */
  testHarness?: {
    http: true;
  };
};

export type JNdataGamemodeData = {
  ranks: {
    [rank: string]: {
      price: number;
      color: string;
    };
  };
  gkits: {
    [gkit: string]: number;
  };
};

/**
 * Per-server gamemode map: `{ [gamemode]: { ranks, gkits } }`.
 * (Some entries in the JSON also carry server metadata strings; those are
 * ignored at runtime by gamemode iteration.)
 */
export type JNdataServer = {
  [gamemode: string]: JNdataGamemodeData;
};

/** Backwards-compatible alias. */
export type JNdataSection = JNdataServer;

/**
 * Per-gamemode rules describing *how* the bot reaches the gamemode after
 * connecting to the server. See `src/common/joinBehaviour.ts`.
 */
export type GamemodeJoinBehaviour =
  | { kind: 'auto' }
  | { kind: 'direct' }
  | { kind: 'command'; command: string }
  | { kind: 'action'; action?: ProfileScript } // main(bot, settings, [gamemode])
  | {
      kind: 'selector';
      hotbarSlot: number; // 1-9, slot the selector item lives on
      pick: 'name' | 'slot'; // find the gamemode item by name, or click a fixed slot
      staticSlot?: number; // 0-53, only used when pick === 'slot'
    };

export type JNdataDataSection = {
  gamemodes: string[];
  kitGamemodes: string[];
  defaultGamemode: string;
  defaultIp: string;
  defaultPort: number;
  ips: string[];
  /** True for Mojang/Microsoft authenticated servers; omitted means cracked. */
  onlineMode?: boolean;

  /** Keyed by `gamemodeKey(label)` — missing entries fall back to `auto`. */
  joinBehaviours: Record<string, GamemodeJoinBehaviour>;

  name: string;
  shortName: string;
  id: string;
  color: string;
  icon: string | null;

  /**
   * Profile-attached scripts shown on the dashboard for this server.
   * See `src/common/profileScripts.ts`. Optional for backwards
   * compatibility — a missing/empty list renders no script cards.
   */
  scripts?: ProfileScriptList;
  /**
   * Optional plugin reference that renders the player-profile drawer.
   * Resolved + executed in a sandbox on the main side. See
   * `ProfileUiRunner`.
   */
  profileUiAction?: ProfileScript;
  /**
   * Optional plugin reference that is loaded as the *last*
   * plugin in every bot worker for this server. Lets the user override
   * built-in `bot` methods or hook into bot events. See `join.js`.
   */
  botExtensionAction?: ProfileScript;
  /**
   * Plugin ids that must not execute while this profile is active. This is
   * enforced by the main process, not just hidden in the renderer.
   */
  disallowedPlugins?: string[];
  /** Installed from an official (JNbot) share: built-in and read-only. */
  official?: boolean;
  /**
   * Profile-creator defaults for the profile-specific app settings (see
   * `src/common/appSettingsSchema.ts`). Set through the Profile Wizard. Used
   * as the fallback for those settings whenever the user hasn't overridden
   * them while this server is active. Built-in servers may ship these in
   * JNdata; custom profiles store them on `CustomProfile.data`.
   */
  appSettingsDefaults?: Partial<AppSettings>;
};

export interface JNdata {
  version: number;
  /** Ordered list of supported server ids. */
  serverList: string[];
  servers: Record<string, JNdataServer>;
  data: Record<string, JNdataDataSection>;
  versions: string[];
  fullVersions: {
    value: string;
    label: string;
    children: {
      value: string;
      label: string;
    }[];
  }[];
}

export type ActiveProfileObj = {
  gamemodes: JNdataServer;
  data: JNdataDataSection;
  server: string;
};

export class BotEvents {
  activeBots: ActiveBots;
  script: Script_ | null;
  mainWindow: BrowserWindow;

  constructor(activeBots: ActiveBots, mainWindow: BrowserWindow);

  BOT_JOINED(bot: BotInfo): void;
  SEND([event, data]: [string, any, Socket | boolean | undefined]): void;
  READY(): void;
  ERROR(err: any): void;
}

export type Activity = {
  username: string;
  server: string;
  scriptId?: string;
  scriptName?: string;
};

export class Db {
  user: any;
  db?: any;
  UID: string;
  connect(): Promise<void>;
  signin(): Promise<void>;
  createUser(): Promise<void>;
  addActivity(activity: Activity): Promise<void>;
}

export class ScriptHandler {
  macros: Macros;
  settings: Settings_;
  clientEvents: ClientEvents_;
  errorHandler: ErrorHandler;
  windowHandler: WindowHandler_;
  constructor(
    settings: Settings_,
    mainWindow: BrowserWindow,
    macros: Macros,
    errorHandler: ErrorHandler,
    webRTCHandler: WebRTC_nodejs,
  );

  restartScript(instanceId: number): void;
  runScript(
    scriptData: { script: string; arguments?: any },
    scriptOptions?: ScriptOptions,
  ): void;
  stop(instanceId: number): void;
  updateActiveIps(): any;
  getBootstrapRuntime(): ProfileRuntime;
}

export interface MacroCodeJavascript {
  code: string;
}

export type MacroCode =
  | MacroCodeJavascript
  | RecipeDocumentV3
  | AutomationDocument;

export type MacroCodeDb = {
  code: MacroCode;
  info: MacroInfo;
  pluginId: string;
  signature?: string | PluginSignatureV2;
};

export type MacroLanguage = 'js' | 'ts' | 'components' | 'recording';

export type MacroScriptType =
  | 'script'
  | 'action'
  | 'profileUi'
  /**
   * @deprecated Use `action`. Existing bot-extension plugins remain valid
   * for profile bot actions.
   */
  | 'botExtension';

export interface MacroInfo {
  name: string;
  description: string;

  pluginId: string; //

  editedAt: number | null;
  createdAt: number;
  public: boolean;
  language: MacroLanguage;
  downloads?: number;
  /** @deprecated Migrated to device-local `security` provenance on startup. */
  trust?: 'author' | 'verified' | 'trusted' | 'unverified';
  /** Derived local provenance. Never included in signed/exported metadata. */
  security?: PluginProvenance;
  scriptType: MacroScriptType;
  /**
   * @deprecated No longer used
   */
  theme?: ScriptThemeType;
  config?: PluginOptionSchema;
  banner?: string;
}

/** Action-picker entry, optionally sourced from the active server profile. */
export type ScriptActionInfo = MacroInfo & { profile?: true };

type error = { error: string; status?: string; code?: null };

export class Macros {
  db: Db;
  constructor(db: Db, settings?: Settings);
  toList(): MacroInfo[];
  create(info: {
    name: string;
    description: string;
    language: string;
    scriptType: string;
  }): void;
  save(pluginId: string, components: MacroCode): MacroCode | void;
  saveInfo(macroInfo: MacroInfo): void;
  download(pluginId: {
    macroInfo: MacroInfo;
    components?: MacroCode;
  }): Promise<any>;
  getMacro(
    pluginId: string,
    macroCodeOnly?: boolean,
  ): { info: MacroInfo; code: MacroCode; status: string } | error;
  delete(pluginId: string): void;
  exportPortablePlugin(pluginId: string): unknown;
  previewPortablePlugins(packages: unknown[]): unknown[];
  importPortablePlugins(packages: unknown[], decisions: unknown[]): Promise<unknown>;
  getScriptActions(): MacroInfo[];
  takeOffline(macroInfo: MacroInfo): void;
  upload(
    macroData: MacroInfo,
    components: MacroCode,
  ): Promise<{ status: number }>;
  export(macroInfo: MacroInfo, code: MacroCode): void;
  import(): Promise<{ status: string; message: string }>;
  scriptActionData(
    name: string,
  ): { error: string } | { info: MacroInfo; code: MacroCode };
}

export interface Window {
  window: BrowserWindow | null;
  name: string;
  browserWindowId: number;
  options?: { [optionName: string]: any };
  url: string;
  props?: any;
}

export type LaunchWindowOptions = {
  name: string;
  windowID: string;
  options?: object;
  subDir?: string;
  url?: string;
  external?: boolean;
  windowOptions?: any;
};

export type LogMessage = [ConsoleLogValue, LogStatus];
export type FullLogMessage = [
  ConsoleLogValue /* Message */,
  LogStatus,
  string /* scriptName */,
  string /* scriptId */,
  number /* timestamp */,
];

export class ErrorHandler {
  UID: string;
  constructor(UID: string);
  handle(err: {
    message: string;
    stack: string | undefined;
    script: string;
  }): void;
  setScriptHandler(handler: ScriptHandler_): void;
}

export type Types = 'info' | 'warning' | 'error' | 'success';

export type ModelButtonOptions = {
  id: string;
  label: string;
  type: Types;
};

export type ModalOptions = {
  message: string;
  title: string;
  id: string;
  content?: string;
  buttons: ModelButtonOptions[];
  type: Types;
};

/** Minimal, serialisable view of a runnable library plugin. */
export interface PluginSummary {
  name: string;
  pluginId: string;
  description: string;
}

/** Minimal view of an active server profile's runnable dashboard script. */
export interface ProfileScriptSummary {
  /** Stable id within the profile (used to run it). */
  id: string;
  pluginId: string;
  name: string;
  description: string;
}

/** A single console log line, stringified and ready to display. */
export interface WorkerLogEntry {
  text: string;
  /** A `LogStatus` value. */
  level: number;
  scriptName: string;
  ts: number;
}

export type ActiveScriptsType = Record<
  string,
  {
    name: string;
    scriptId: string;
    /** New messaging identity fields; legacy fields remain during migration. */
    pluginId?: string;
    runtimeProfileId?: number;
    runtimeScriptId?: number;
    address?: number;
    instanceId: number;
    /** Name of the preset this instance runs; unset for the Default preset. */
    presetName?: string;
    /** Bitfield of enabled runner control buttons (see ScriptControl enum). */
    controls?: number;
    /** "worker" = normal JNbot worker script, "minecraft" = launched Minecraft instance (no worker). */
    origin?: 'worker' | 'minecraft';
    minecraft?: {
      instanceId: string;
      requestedVersion?: string;
      stage?: string;
      status?: string;
      pid?: number;
      clientId?: string;
    };
  }
>;

export type ActiveActionsType = Record<
  string,
  {
    actionId: string; // Generated each time you run an action
    action: string; // Name of action
    scriptId: string;
    scriptInstance: string;
  }[]
>;

export type UpdateData =
  | {
      state: UpdateState.DOWNLOADING;
      data: number;
    }
  | {
      state: UpdateState.READY_TO_INSTALL;
      data: string;
    }
  | {
      state: UpdateState.ERROR;
      data: string;
    }
  | {
      state: UpdateState.INSTALLING;
      data: null;
    }
  | {
      state: UpdateState.NO_UPDATE;
      data: null;
    };

export interface KickBehaviorRule {
  id: string;
  kickMessage: string;
  action: KickBehaviorOptions;
}

export interface KickBehaviorConfig {
  rules: KickBehaviorRule[];
  defaultAction: KickBehaviorOptions;
}

export interface ButtonSnackbarProps {
  isMain?: boolean;
  popupID: string;
  onClose: () => void;
  btns?: { label: string; id: string; variant?: BaseButtonProps['variant'] }[];
  messageAddress?: number;
}

export type MinecraftLaunchStage =
  | 'installing-modloader'
  | 'installing'
  | 'launching'
  | 'window-ready'
  | 'exit'
  | 'error';

export type LaunchLogEntry = {
  sequence: number;
  bridgeInstanceId: string;
  timestamp: number;
  message: string;
  type: 'stdout' | 'stderr' | 'info' | 'error';
};

export type MinecraftInstallProgressPayload = {
  bridgeInstanceId: string;
  name: string;
  progress: number;
  total: number;
  state: string;
};

export type MinecraftLaunchStatusPayload = {
  bridgeInstanceId: string;
  stage: MinecraftLaunchStage;
  username: string;
  version: string;
  launchVersionId?: string;
  launcherFlags?: MinecraftLauncherTypes;
  modLoader?: 'fabric' | 'vanilla';
  instancePath?: string;
  pid?: number;
  code?: number | null;
  signal?: string | null;
  error?: string;
};

export type MinecraftLaunchLogSnapshot = {
  bridgeInstanceId: string | null;
  entries: LaunchLogEntry[];
  truncated: boolean;
};

export type MinecraftLaunchLogBatch = MinecraftLaunchLogSnapshot & {
  reset: boolean;
};

export type MinecraftCrashInfo = {
  bridgeInstanceId: string;
  username: string;
  version: string;
  instancePath: string;
  code?: number | null;
  signal?: string | null;
  error?: string;
  latestLogPath?: string;
  latestLogTail?: string;
  crashReportPath?: string;
  crashReportTail?: string;
  hsErrPath?: string;
  hsErrTail?: string;
  stdoutTail?: string;
  stderrTail?: string;
};

export type MinecraftInstanceStatus =
  | 'starting'
  | 'running'
  | 'exited'
  | 'error';

export interface MinecraftInstanceInfo {
  instanceId: string;
  username: string;
  requestedVersion: string;
  status: MinecraftInstanceStatus;
  stage: MinecraftLaunchStage;
  createdAt: number;
  updatedAt: number;
  pid?: number;
  instancePath?: string;
  minecraftRoot?: string;
  modLoader?: 'fabric' | 'vanilla';
  clientId?: string;
}

export type MinecraftInstancesType = MinecraftInstanceInfo[];

export interface MinecraftGameSessionInfo {
  clientId: string;
  username?: string;
  uuid?: string;
  instanceId?: string;
  serverAddress: string;
  serverKind: 'singleplayer' | 'multiplayer' | 'unknown';
  joinedAt: number;
  lastSeenAt: number;
}

export type MinecraftSessionsType = MinecraftGameSessionInfo[];

export type ModInfo = {
  id: string;
  name: string;
  mcVersion: string;
  versionNumber: string;
  file: {
    id: string;
    filename: string;
    url: string;
  };
  projectId: string;
  iconUrl?: string;
};

export type ModpackInfo = ModInfo & { indexFile: string };

export type ModList = {
  mods: ModInfo[];
  modpacks: ModpackInfo[];
  activeMods: string[];
  activeModPacks: string[];
  mcVersion: string;
};
