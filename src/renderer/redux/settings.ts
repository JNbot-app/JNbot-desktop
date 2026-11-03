import type {
  JNdata,
  Alt,
  AltTag,
  AltWithData,
  AppSettings,
  Stats,
  SettingsObj,
  SharedSettings,
  ActiveScriptsType,
  ActiveBotsType,
  ActiveActionsType,
  JNbotServerStatus,
  UpdateData,
  JNdataDataSection,
  LaunchMinecraftOptions,
  MacroInfo,
  ActiveProfileObj,
} from '../../main/src/types';
import type { RemoteCapability } from '../../common/clientPermissions';
import {
  makeActiveScriptsService,
  ActiveScriptsService,
} from '../services/ActiveScriptsService';
import { CustomProfile, mergeProfilesIntoJNdata } from '../../common/profiles';
import { STATIC_JNDATA } from '../../common/jndata';
import { getInstalledServerMeta, getServerMeta, ServerMeta } from '../../common/serverInfo';
import { useSettingsStore, set, mergeAlts, type SettingsState } from './store';
import type { ProfilePublication } from '../../common/messaging';
import {
  getSelectedProfileKey,
  persistSelectedProfileKey,
} from './profileSelection';

export interface ProfileSnapshot {
  profileId: number;
  profileKey: string;
  settings: SettingsObj;
  appSettings: AppSettings;
  activeScripts: ActiveScriptsType;
  activeBots: ActiveBotsType;
  activeScriptActions: ActiveActionsType;
  progress: Record<number, unknown>;
  serverStatus: { ips: string[] };
}

export const applyProfileSnapshot = (snapshot: ProfileSnapshot) =>
  set((state) => {
    if (state.selectedProfileKey !== snapshot.profileKey) return;
    state.selectedProfileId = snapshot.profileId;
    persistSelectedProfileKey(snapshot.profileKey);
    state.settings = snapshot.settings;
    state.alts = mergeAlts(state.sharedAlts, snapshot.settings.altData);
    const appSettings = {
      ...snapshot.appSettings,
      server: snapshot.profileKey as any,
    };
    state.appSettings = appSettings;
    state.activeScripts = snapshot.activeScripts;
    state.activeBots = snapshot.activeBots;
    state.activeScriptActions = snapshot.activeScriptActions;
    state.ready = true;
  });

export const applyProfilePublication = (publication: ProfilePublication) =>
  set((state) => {
    if (state.selectedProfileId !== publication.profileId) return;
    switch (publication.event) {
      case 'settings':
        state.settings = publication.data as SettingsObj;
        state.alts = mergeAlts(state.sharedAlts, state.settings.altData);
        break;
      case 'appSettings': {
        const appSettings = {
          ...(publication.data as AppSettings),
          server: state.selectedProfileKey as any,
        };
        state.appSettings = appSettings;
        break;
      }
      case 'activeScripts':
        state.activeScripts = publication.data as ActiveScriptsType;
        break;
      case 'activeBots':
        state.activeBots = publication.data as ActiveBotsType;
        if (
          state.selectedBot &&
          !state.activeBots.some(
            (bot) => bot.botId === state.selectedBot!.botId,
          )
        ) {
          state.selectedBot = null;
        }
        break;
      case 'ACTIVE_ACTION_SCRIPT':
        state.activeScriptActions = publication.data as ActiveActionsType;
        break;
    }
  });

// Re-export the store + state types so existing `./redux/settings` imports
// keep working unchanged.
export {
  useSettingsStore,
  set,
  type SettingsState,
  type RootState,
  type NotificationType,
  type NotificationsState,
  type TutorialState,
  type ProxyInfo,
  PLUGINS_UI_STORAGE_KEY,
} from './store';

// Re-export every write action so consumers can `import { setX } from
// './redux/settings'` and just call it — no dispatch needed.
export * from './settingReducers';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const nextTutorialStep = () =>
  set((state) => {
    state.tutorial.step++;
  });

export const startTutorial = (tutorial: number) =>
  set((state) => {
    if (isNaN(tutorial))
      return console.log('startTutorial: tutorial is not a number');
    state.tutorial = { step: 0, tutorial };
  });

export const stopTutorial = () =>
  set((state) => {
    state.tutorial = { step: 0, tutorial: 0 };
  });

export const setSettings = (payload: SettingsObj) =>
  set((state) => {
    if (payload) {
      state.settings = payload;
      // Re-merge against the cross-server identity list so consumers see
      // the new altData immediately.
      state.alts = mergeAlts(state.sharedAlts, payload.altData);
    }
  });

export const setShared = (shared: SharedSettings) =>
  set((state) => {
    if (!shared) return;
    if (Array.isArray(shared.alts)) {
      state.sharedAlts = shared.alts;
      state.alts = mergeAlts(shared.alts, state.settings.altData);
    }
    if (shared.pluginMetadata) state.pluginMetadata = shared.pluginMetadata;
    if (shared.launcherOptions) state.launcherOptions = shared.launcherOptions;
  });

export const setActiveScript = (payload: ActiveScriptsType) =>
  set((state) => {
    if (payload) {
      state.activeScripts = payload;
    }
  });

export const setAppSettings = (payload: AppSettings) =>
  set((state) => {
    if (payload) {
      const selectedProfileKey =
        state.selectedProfileKey ?? getSelectedProfileKey(payload.server);
      const appSettings = {
        ...payload,
        ...(selectedProfileKey
          ? { server: selectedProfileKey as AppSettings['server'] }
          : {}),
      };
      state.appSettings = appSettings;
      state.selectedProfileKey = selectedProfileKey;
      // A selected profile is usable only after its scoped snapshot arrives.
      // With no selection, leave the intro/marketplace available.
      if (state.selectedProfileId === null)
        state.ready = !state.selectedProfileKey;
      if (payload.theme !== state.theme) {
        (window as any).theme = payload.theme ?? 'default';
      }
    }
  });

export const setJNdata = (payload: JNdata) =>
  set((state) => {
    // An empty serverList is valid: no profile is installed yet.
    const valid =
      !!payload &&
      Array.isArray(payload.serverList) &&
      !!payload.servers &&
      !!payload.data;
    if (valid) {
      state.JNdata = payload;
    } else {
      console.error('Setting invalid JNdata: ', payload);
    }
  });

export const setAlts = (payload: AltWithData[]) =>
  set((state) => {
    if (Array.isArray(payload)) {
      state.alts = payload;
    }
  });

export const setActiveBots = (payload: ActiveBotsType) =>
  set((state) => {
    if (payload) {
      state.activeBots = payload;
      if (
        state.selectedBot &&
        !payload.some((b) => b.botId === state.selectedBot!.botId)
      ) {
        state.selectedBot = null;
      }
    }
  });

export const setSelectedBot = (payload: ActiveBotsType[number] | null) =>
  set((state) => {
    state.selectedBot = payload;
  });

export const setActiveScriptActions = (payload: ActiveActionsType) =>
  set((state) => {
    if (payload) {
      state.activeScriptActions = payload;
    }
  });

export const setDevices = (payload: JNbotServerStatus) =>
  set((state) => {
    if (payload) {
      state.devices = payload;
    }
  });

export const setStats = (payload: Stats) =>
  set((state) => {
    if (payload) {
      state.stats = payload;
    }
  });

export const addNotification = (
  payload: Omit<import('./store').NotificationType, 'timestamp'>,
) =>
  set((state) => {
    if (!payload) return;
    state.notifications.unread += 1;
    state.notifications.notifications.unshift({
      ...payload,
      timestamp: Date.now(),
    });
  });

export const readNotification = () =>
  set((state) => {
    state.notifications.unread = 0;
  });

export const clearNotifications = () =>
  set((state) => {
    state.notifications = { unread: 0, notifications: [] };
  });

export const setUpdate = (payload: UpdateData) =>
  set((state) => {
    if (payload) {
      state.update = payload;
    }
  });

export const setJNbotProxyInfo = (proxy: import('./store').ProxyInfo | null) =>
  set((state) => {
    if (!proxy) return;
    state.proxy = proxy;
  });

export const setRecordings = (recordings: any) =>
  set((state) => {
    if (!recordings) return;
    state.recordings = recordings;
  });

export const setMacros = (payload: MacroInfo[]) =>
  set((state) => {
    state.macros.list = payload;
    state.macros.loaded = true;
  });

export const upsertMacro = (payload: MacroInfo) =>
  set((state) => {
    const i = state.macros.list.findIndex(
      (m) => m.pluginId === payload.pluginId,
    );
    if (i >= 0) state.macros.list[i] = payload;
    else state.macros.list.unshift(payload);
  });

export const removeMacro = (payload: string) =>
  set((state) => {
    state.macros.list = state.macros.list.filter((m) => m.pluginId !== payload);
  });

export const setPluginsUi = (payload: Partial<SettingsState['pluginsUi']>) =>
  set((state) => {
    state.pluginsUi = { ...state.pluginsUi, ...payload };
  });

/**
 * Mirror the live store's JNdata onto the `window.__JNdata` global. Components
 * that read the merged data directly off that global (gamemode pickers, the
 * settings builder, …) only update when this is kept in sync — the store
 * setter alone isn't enough. Same role the messager's `JNdata` listener plays
 * for main-pushed updates; we do it here for optimistic local changes.
 */
const syncJNdataGlobal = () => {
  (window as any).__JNdata = useSettingsStore.getState().JNdata;
};

export const setCustomProfiles = (payload: CustomProfile[]) => {
  if (!Array.isArray(payload)) return;
  const profiles = payload.filter((p) => p && p.id);
  set((state) => {
    state.customProfiles = profiles;
    // Mirror the merge that happens in main so UI sees new profiles
    // immediately, without waiting for the JNdata broadcast round-trip.
    state.JNdata = mergeProfilesIntoJNdata(STATIC_JNDATA, profiles);
  });
  syncJNdataGlobal();
};

/** Upsert in the store + send full list to main for persistence. */
export const upsertCustomProfile = (p: CustomProfile) => {
  if (!p?.id) return;
  set((state) => {
    const next = state.customProfiles.filter((x) => x.id !== p.id);
    next.push({ ...p, predefined: false, updatedAt: Date.now() });
    state.customProfiles = next;
    state.JNdata = mergeProfilesIntoJNdata(STATIC_JNDATA, next);
  });
  syncJNdataGlobal();
  // Send the finalized (non-draft) list: immer drafts can't be structured-cloned over IPC.
  window.ipcRenderer.send(
    'profiles-update',
    useSettingsStore.getState().customProfiles,
  );
};

export const deleteCustomProfile = (id: string) => {
  if (!id) return;
  set((state) => {
    state.customProfiles = state.customProfiles.filter((p) => p.id !== id);
    state.JNdata = mergeProfilesIntoJNdata(STATIC_JNDATA, state.customProfiles);
  });
  syncJNdataGlobal();
  window.ipcRenderer.send(
    'profiles-update',
    useSettingsStore.getState().customProfiles,
  );
};

// ---------------------------------------------------------------------------
// Selectors — pass to `useSettingsStore(selector)` so a component only
// re-renders when the slice it reads actually changes.
// ---------------------------------------------------------------------------

export const selectTutorial = (state: SettingsState) => state.tutorial;
export const selectSharedAlts = (state: SettingsState): Alt[] =>
  state.sharedAlts;
export const selectSettings = (state: SettingsState): SettingsObj =>
  state.settings;
export const selectAppSettings = (state: SettingsState): AppSettings =>
  state.appSettings;
export const selectRemotePermissionMask = (state: SettingsState): number | null =>
  state.remotePermissionMask;
export const selectCanUseActiveBots = (state: SettingsState): boolean =>
  state.remoteCapabilities?.canUseActiveBots ?? true;
export const selectCanUsePlugins = (state: SettingsState): boolean =>
  state.remoteCapabilities?.canUsePlugins ?? true;
export const selectCanUseAccounts = (state: SettingsState): boolean =>
  state.remoteCapabilities?.canUseAccounts ?? true;
export const selectCanUseScripts = (state: SettingsState): boolean =>
  state.remoteCapabilities?.canUseScripts ?? true;
export const selectCanChangeGlobalSettings = (state: SettingsState): boolean =>
  state.remoteCapabilities?.canChangeGlobalSettings ?? true;
export const selectCanManageProfiles = (state: SettingsState): boolean =>
  state.remoteCapabilities?.canManageProfiles ?? true;
export const selectCanManageAccess = (state: SettingsState): boolean =>
  state.remoteCapabilities?.canManageAccess ?? true;
export const selectCanUseHostTools = (state: SettingsState): boolean =>
  state.remoteCapabilities?.canUseHostTools ?? true;
export const selectCanUseCapability = (capability: RemoteCapability) =>
  (state: SettingsState): boolean =>
    state.remoteCapabilities?.can(capability) ?? true;
/** True once the initial appSettings (active server) has been received. */
export const selectReady = (state: SettingsState): boolean => state.ready;
export const selectActiveScripts = (state: SettingsState): ActiveScriptsType =>
  state.activeScripts;
export const selectActiveBots = (state: SettingsState): ActiveBotsType =>
  state.activeBots;
export const selectNotifications = (state: SettingsState) =>
  state.notifications;

export const selectLauncherOptions = (
  state: SettingsState,
): LaunchMinecraftOptions | null => state.launcherOptions;

/**
 * reselect-style single-slot memoizer. Recomputes only when one of the
 * referenced inputs changes (by `Object.is`), keeping a derived selector's
 * result referentially stable across renders. This is required for any
 * selector that computes a fresh object/array: zustand v5 reads through
 * `useSyncExternalStore`, which loops ("getSnapshot should be cached") if the
 * selector returns a new reference on every call.
 */
const memoSelector = <R>(
  inputs: (s: SettingsState) => readonly unknown[],
  compute: (...args: any[]) => R,
): ((s: SettingsState) => R) => {
  let lastInputs: readonly unknown[] | null = null;
  let lastResult: R;
  return (s) => {
    const next = inputs(s);
    if (
      !lastInputs ||
      next.length !== lastInputs.length ||
      next.some((v, i) => !Object.is(v, lastInputs![i]))
    ) {
      lastResult = compute(...next);
      lastInputs = next;
    }
    return lastResult;
  };
};

const EMPTY_ALT_TAGS: AltTag[] = [];
const EMPTY_STRING_ARRAY: string[] = [];

export const selectJNDataByServer = memoSelector(
  (s) => [s.JNdata, s.appSettings.server],
  (jndata: JNdata, serverSetting: string | undefined): ActiveProfileObj => {
    const server = serverSetting || jndata?.serverList?.[0] || '';
    return {
      gamemodes: jndata?.servers?.[server] ?? {},
      data:
        jndata?.data?.[server] ??
        ({
          gamemodes: [],
          kitGamemodes: [],
          defaultGamemode: '',
          defaultIp: '',
          defaultPort: 25565,
          ips: [],
          joinBehaviours: {},
          name: server,
          shortName: server,
          id: server,
          color: '#8C8C8C',
          icon: null,
          scripts: [],
        } as JNdataDataSection),
      server,
    };
  },
);

export const selectAlts = (state: SettingsState): AltWithData[] => state.alts;
export const selectSelectedBot = (
  state: SettingsState,
): ActiveBotsType[number] | null => state.selectedBot;
export const selectJNdata = (state: SettingsState): JNdata => state.JNdata;
export const selectDevices = (state: SettingsState): JNbotServerStatus =>
  state.devices;
export const selectStats = (state: SettingsState): Stats => state.stats;
export const selectActiveScriptsActions = (
  state: SettingsState,
): ActiveActionsType => state.activeScriptActions;
export const selectJNbotProxyInfo = (state: SettingsState) => state.proxy;
export const selectRecordings = (state: SettingsState): any => state.recordings;
export const selectScripts = memoSelector(
  (s) => [s.activeScripts],
  (activeScripts: ActiveScriptsType): ActiveScriptsService =>
    makeActiveScriptsService(activeScripts),
);

/** Alt tags for the active server. */
export const selectAltTags = (state: SettingsState): AltTag[] =>
  state.settings.altTags ?? EMPTY_ALT_TAGS;

export const selectCustomProfiles = (state: SettingsState): CustomProfile[] =>
  state.customProfiles;

/** Metadata for every installed profile (official and custom). */
export const selectInstalledServers = memoSelector(
  (s) => [s.JNdata, s.customProfiles],
  (jndata: JNdata, customProfiles: CustomProfile[]): ServerMeta[] =>
    getInstalledServerMeta(
      jndata,
      customProfiles.map((p) => p.id),
    ),
);

/** Installed profile ids in JNdata.serverList order. */
export const selectInstalledServerIds = (state: SettingsState): string[] =>
  state.JNdata?.serverList ?? EMPTY_STRING_ARRAY;

/**
 * True once JNdata + appSettings have loaded AND the active server points
 * at something the user can actually use. False during initial load or
 * after the active server has been deleted/uninstalled.
 */
export const selectActiveServerValid = (state: SettingsState): boolean => {
  const server = state.appSettings.server;
  if (!server) return false;
  return selectInstalledServerIds(state).includes(server);
};

/** ID of the server/profile the user currently has selected. */
export const selectActiveServerId = (
  state: SettingsState,
): string | undefined => state.selectedProfileKey ?? state.appSettings.server;

/** Helper for components that want the live ServerMeta for the active server. */
export const selectActiveServerMeta = memoSelector(
  (s) => [s.JNdata, selectActiveServerId(s)],
  (jndata: JNdata, server: string | undefined): ServerMeta | null =>
    server ? getServerMeta(jndata, server) : null,
);

/** Gamemodes available on the currently active server. */
export const selectActiveServerGamemodes = memoSelector(
  (s) => [s.JNdata, selectActiveServerId(s)],
  (jndata: JNdata, serverId: string | undefined): string[] => {
    if (!serverId) return EMPTY_STRING_ARRAY;
    return getServerMeta(jndata, serverId).gamemodes;
  },
);

export const selectProfileById =
  (id: string | null | undefined) =>
  (state: SettingsState): CustomProfile | undefined =>
    id ? state.customProfiles.find((p) => p.id === id) : undefined;

export const selectMacros = (state: SettingsState) => state.macros;
export const selectPluginMetadata = (state: SettingsState) =>
  state.pluginMetadata;
export const selectMacroById =
  (pluginId: string | null | undefined) =>
  (state: SettingsState): MacroInfo | undefined =>
    pluginId
      ? state.macros.list.find((m) => m.pluginId === pluginId)
      : undefined;
export const selectPluginsUi = (state: SettingsState) => state.pluginsUi;
export const selectIsMacroActive =
  (pluginId: string) =>
  (state: SettingsState): boolean => {
    for (const v of Object.values(state.activeScripts)) {
      if (v?.scriptId === pluginId) return true;
    }
    return false;
  };

export default useSettingsStore;
