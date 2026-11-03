import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Draft } from 'immer';
import type {
  JNdata,
  Alt,
  AltWithData,
  AppSettings,
  Stats,
  SettingsObj,
  PluginMetadata,
  ActiveScriptsType,
  ActiveBotsType,
  ActiveActionsType,
  JNbotServerStatus,
  UpdateData,
  MacroInfo,
  LaunchMinecraftOptions,
} from '../../main/src/types';
import { UpdateState } from '../../common/CommonEnums';
import { CustomProfile } from '../../common/profiles';
import type { RemoteAccessCapabilities } from '../../common/clientPermissions';
import type { ProxyInfo as SharedProxyInfo } from '../../common/types/proxyApi';
import type { NotificationButton } from '../../common/mobileClientContract';
import { STATIC_JNDATA } from '../../common/jndata';

// Store State Types
export interface NotificationType {
  title: string;
  message: string;
  timestamp: number;
  type: 'success' | 'error' | 'warning' | 'info';
  buttons?: NotificationButton[];
}

export interface NotificationsState {
  unread: number;
  notifications: NotificationType[];
}

export interface TutorialState {
  step: number;
  tutorial: number; // 0 - no tutorial, 1 - create alt, 2 - start gkit collector
}

export type ProxyInfo = SharedProxyInfo;

export interface SettingsState {
  selectedProfileId: number | null;
  selectedProfileKey: string | null;
  /** Active server's per-server settings. */
  settings: SettingsObj;
  /**
   * Active-profile alts: cross-server identities that have an altData entry
   * for the currently active server. Alts configured only on other profiles
   * are not included — they live in `sharedAlts`.
   */
  alts: AltWithData[];
  /** Cross-server identity list (mirrors shared.json's alts). */
  sharedAlts: Alt[];
  /** Local plugin-library metadata from shared.json. */
  pluginMetadata: PluginMetadata;
  launcherOptions: LaunchMinecraftOptions | null;
  appSettings: AppSettings;
  activeScripts: ActiveScriptsType;
  activeBots: ActiveBotsType;
  activeScriptActions: ActiveActionsType;
  notifications: NotificationsState;
  theme: string;
  update: UpdateData;
  selectedBot: ActiveBotsType[number] | null;
  JNdata: JNdata;
  devices: JNbotServerStatus; // runtime remote-access status
  tutorial: TutorialState;
  stats: Stats;
  proxy: ProxyInfo | null;
  recordings: any;
  macros: { loaded: boolean; list: MacroInfo[] };
  pluginsUi: {
    search: string;
    folder: string; // '__all__' | '__none__' | folder name
    viewMode: 'grid' | 'list';
    sortOrder: 'name' | 'date';
    extraFolders: string[];
  };
  /** User-defined server profiles (custom only — predefined live in JNdata). */
  customProfiles: CustomProfile[];
  /** Null for desktop; remote clients receive this in their bootstrap. */
  remotePermissionMask: number | null;
  /** Null for desktop; remote clients receive these during the handshake. */
  remoteCapabilities: RemoteAccessCapabilities | null;
  /**
   * False until the main process has pushed the initial `appSettings` (which
   * carries the active `server`). UI that resolves the active profile waits on
   * this so it never renders against the fallback server first.
   */
  ready: boolean;
}

/**
 * Back-compat alias: legacy selectors were typed against `RootState`
 * (`{ settings: SettingsState }`). The zustand store is flat, so the root
 * state *is* the settings state.
 */
export type RootState = SettingsState;

const initialSettings: SettingsObj = {
  scripts: {},
  pluginData: {},
  reminders: [],
  triggers: [],
  altTags: [],
  altData: {},
  version: 3,
};

/** Re-derive the active-profile alts from the shared identity list + altData. */
export const mergeAlts = (
  sharedAlts: Alt[],
  altData: SettingsObj['altData'] | undefined,
): AltWithData[] => {
  const data = altData ?? {};
  // Only surface alts that belong to the active profile (have an altData
  // entry on this server). Cross-profile identities live in `sharedAlts`.
  return sharedAlts
    .filter((alt) => data[alt.username])
    .map((alt) => ({ ...alt, data: data[alt.username]! }));
};

export const PLUGINS_UI_STORAGE_KEY = 'pluginsUi';

const defaultPluginsUi: SettingsState['pluginsUi'] = {
  search: '',
  folder: '__all__',
  viewMode: 'grid',
  sortOrder: 'date',
  extraFolders: [],
};

const loadPersistedPluginsUi = (): SettingsState['pluginsUi'] => {
  try {
    const raw = window.localStorage.getItem(PLUGINS_UI_STORAGE_KEY);
    if (!raw) return defaultPluginsUi;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return defaultPluginsUi;
    // Only restore persistable, validated fields; `search` is intentionally transient.
    return {
      ...defaultPluginsUi,
      folder: typeof v.folder === 'string' ? v.folder : '__all__',
      viewMode: v.viewMode === 'list' ? 'list' : 'grid',
      sortOrder: v.sortOrder === 'name' ? 'name' : 'date',
      extraFolders: Array.isArray(v.extraFolders) ? v.extraFolders : [],
    };
  } catch {
    return defaultPluginsUi;
  }
};

const initialState: SettingsState = {
  selectedProfileId: null,
  selectedProfileKey: null,
  settings: initialSettings,
  alts: [],
  sharedAlts: [],
  pluginMetadata: {},
  launcherOptions: {
    minMemoryMB: 512,
    maxMemoryMB: 2048,
    version: '1.21.11',
    username: '',
    minecraftDirectory: undefined,
    window: { fullscreen: false },
    gamemode: null,
  },
  appSettings: {},
  activeScripts: {},
  activeBots: [],
  activeScriptActions: {},
  notifications: { unread: 0, notifications: [] },
  theme: 'default',
  update: { state: UpdateState.NO_UPDATE, data: null },
  selectedBot: null,
  JNdata: window.__JNdata ?? STATIC_JNDATA,
  devices: {
    devices: [],
    peer2peer: { status: false },
  },
  tutorial: { step: 0, tutorial: 0 },
  stats: { alts: {}, scripts: {} } as any,
  proxy: null,
  recordings: null,
  macros: { loaded: false, list: [] },
  pluginsUi: loadPersistedPluginsUi(),
  customProfiles: [],
  remotePermissionMask: null,
  remoteCapabilities: null,
  ready: false,
};

/**
 * Central settings store. State only — actions live in `./settings` and
 * mutate the store via `useSettingsStore.setState(...)` (immer middleware lets
 * them be written in mutation style). Subscribe with a *specific* selector,
 * e.g. `useSettingsStore(selectAlts)`, so components only re-render when the
 * slice they read changes.
 */
export const useSettingsStore = create<SettingsState>()(
  immer(() => initialState),
);

/**
 * Mutate the store in immer mutation style. Recipe receives a draft you can
 * mutate directly — immer produces the new immutable state from it, so there's
 * no need to clone or spread anything by hand.
 */
export const set = (recipe: (state: Draft<SettingsState>) => void) =>
  useSettingsStore.setState(recipe);

export default useSettingsStore;
