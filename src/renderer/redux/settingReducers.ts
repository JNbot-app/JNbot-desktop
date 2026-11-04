import { current, isDraft } from 'immer';
import type { Draft } from 'immer';
import type {
  Alt,
  AltTag,
  AltWithData,
  Trigger,
  Chain,
  ChainOptions,
  MacroInfo,
  Reminder,
  ServerAltInfo,
  SettingsObj,
  SettingsPatch,
  LaunchMinecraftOptions,
  SharedSettingsUpdate,
} from '../../main/src/types';
import { set, useSettingsStore, type SettingsState } from './store';
import type { ServerTypes } from '../../main/src/types';
import type { AltUpdates } from '../components/other/AltUpdateRequests';
import { persistSelectedProfileKey } from './profileSelection';
import { isProfileSpecificSetting } from '../../common/appSettingsSchema';

export interface UpdateScriptSettingsPayload {
  optionId: string;
  value: any | any[];
  scriptName: string;
}

export interface SaveAltPayload {
  alt: AltWithData;
  originalUsername?: string;
}

export interface ChangeAltOrderPayload {
  destination: number;
  source: number;
}

/**
 * Read a value from a finalized settings snapshot without weakening its type
 * to `any` at the IPC boundary.
 */
function getSettingAtPath(settings: SettingsObj, path: SettingsPatch['path']) {
  return path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === 'object'
        ? Reflect.get(value, key)
        : undefined,
    settings,
  );
}

/**
 * Persist patches from the active server's settings. Values are always read
 * from one Immer snapshot after the caller has mutated the draft. This keeps
 * draft proxies out of IPC payloads, including proxies nested inside an
 * otherwise plain object, and makes the store the single source of truth.
 */
function pushSettings(
  state: Draft<SettingsState>,
  patches: Array<Pick<SettingsPatch, 'path' | 'remove'>>,
): void {
  if (state.selectedProfileId === null) return;

  const settings = current(state.settings);
  window.messenger.profileAction(
    state.selectedProfileId,
    'SETTINGS_UPDATE',
    patches.map(
      (patch): SettingsPatch =>
        patch.remove
          ? patch
          : { ...patch, value: getSettingAtPath(settings, patch.path) },
    ),
  );
}

function pushShared(update: SharedSettingsUpdate) {
  // JSON round-trip detaches anything that might be an Immer draft so the
  // payload is safe for structured-clone over IPC.
  const payload = JSON.parse(JSON.stringify(update));
  window.ipcRenderer.send('shared-update', payload);
}

export const setPluginMetadata = (
  pluginMetadata: SettingsState['pluginMetadata'],
) =>
  set((state) => {
    state.pluginMetadata = pluginMetadata;
    pushShared({ pluginMetadata });
  });

/**
 * Persist the active-profile alts — state.alts only contains identities
 * with altData on this server. shared.alts entries for other profiles are
 * preserved; the current-profile entries are upserted (and reordered into
 * shared.alts' tail if newly created).
 */
type AltRename = { from: string; to: string };

function pushAlts(state: Draft<SettingsState>, rename?: AltRename) {
  const stripIdentity = (a: AltWithData | Alt): Alt => ({
    username: a.username,
    UID: a.UID,
  });

  // state.alts is the active-profile list in display order — keep that order
  // when rebuilding shared.alts so reordering sticks. Other-profile identities
  // are appended afterwards (each profile filters to its own alts).
  const alts = isDraft(state.alts) ? current(state.alts) : state.alts;
  const sharedAlts: Alt[] = [];
  const seen = new Set<string>();
  for (const a of alts) {
    const existing = state.sharedAlts.find(
      (candidate) =>
        candidate.username.toLowerCase() === a.username.toLowerCase() ||
        candidate.username.toLowerCase() === rename?.from.toLowerCase(),
    );
    const identity = stripIdentity(a);
    sharedAlts.push({
      ...existing,
      ...identity,
      UID: identity.UID ?? existing?.UID,
    });
    seen.add(a.username.toLowerCase());
  }
  for (const s of state.sharedAlts) {
    if (
      !seen.has(s.username.toLowerCase()) &&
      s.username.toLowerCase() !== rename?.from.toLowerCase()
    )
      sharedAlts.push(stripIdentity(s));
  }

  const altData: SettingsObj['altData'] = {};
  for (const a of alts) {
    if (a.data) altData[a.username] = a.data;
  }

  state.sharedAlts = sharedAlts;
  state.settings.altData = altData;
  if (state.selectedProfileId !== null) {
    window.messenger.profileAction(state.selectedProfileId, 'ALT_UPDATE', {
      alts,
      rename,
    });
  }
}

export const updateScriptSettings = (data: UpdateScriptSettingsPayload) =>
  set((state) => {
    if (!data.scriptName) return console.error('Type not found');
    const scripts = (state.settings.scripts ??= {});
    const script = (scripts[data.scriptName] ??= {});

    const { optionId: key, value } = data;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const option = script[key];
      if (
        option !== null &&
        typeof option === 'object' &&
        !Array.isArray(option)
      ) {
        Object.assign(option, value);
      } else {
        script[key] = { ...value };
      }
    } else {
      script[key] = value;
    }
    pushSettings(state, [{ path: ['scripts', data.scriptName, key] }]);
  });

export const saveAlt = ({ alt, originalUsername }: SaveAltPayload) =>
  set((state) => {
    if (!alt?.username) return;
    if (originalUsername) {
      const originalKey = originalUsername.toLowerCase();
      const index = state.alts.findIndex(
        (a) => a.username.toLowerCase() === originalKey,
      );
      // The alt may have been removed concurrently; writing alts[-1] would
      // silently corrupt the array (adds a "-1" property) instead of no-op'ing.
      if (index === -1) return;
      state.alts[index] = alt;
      if (originalUsername !== alt.username) {
        for (const tag of state.settings.altTags ?? []) {
          tag.alts = tag.alts.map((username) =>
            username.toLowerCase() === originalKey ? alt.username : username,
          );
        }
      }
    } else {
      const usernameKey = alt.username.toLowerCase();
      if (state.alts.some((a) => a.username.toLowerCase() === usernameKey))
        return;

      const sharedIdentity = state.sharedAlts.find(
        (sharedAlt) => sharedAlt.username.toLowerCase() === usernameKey,
      );
      const profileAlt: AltWithData = sharedIdentity
        ? { ...alt, ...sharedIdentity, data: alt.data }
        : alt;
      state.alts.push(profileAlt);
      window.ipcRenderer.action('ALT_CREATED', profileAlt);
    }
    const rename =
      originalUsername && originalUsername !== alt.username
        ? { from: originalUsername, to: alt.username }
        : undefined;
    pushAlts(state, rename);
  });

export const changeAltOrder = ({
  destination,
  source,
}: ChangeAltOrderPayload) =>
  set((state) => {
    const [removed] = state.alts.splice(source, 1);
    state.alts.splice(destination, 0, removed);
    pushAlts(state);
  });

export const setAllAlts = (payload: AltWithData[]) =>
  set((state) => {
    if (Array.isArray(payload)) {
      state.alts = payload;
      pushAlts(state);
    }
  });

export const setChain = (chain: Chain) =>
  set((state) => {
    if (!chain) return;
    const scripts = (state.settings.scripts ??= {});
    scripts.chains ??= {};
    scripts.chains[chain.id] = chain;
    pushSettings(state, [{ path: ['scripts', 'chains', chain.id] }]);
  });

/**
 * Write a chain's run settings to `settings.scripts[chainId]` — the same flat
 * slot `<ScriptSettings>` reads/writes. Used to seed defaults for a new chain
 * and to migrate chains whose options were still nested on the chain object.
 */
export const setChainOptions = (chainId: string, options: ChainOptions) =>
  set((state) => {
    if (!chainId) return;
    const scripts = (state.settings.scripts ??= {});
    scripts[chainId] = options;
    pushSettings(state, [{ path: ['scripts', chainId] }]);
  });

export const deleteChain = (chainId: string) =>
  set((state) => {
    if (!chainId || !state.settings.scripts?.chains?.[chainId]) return;
    delete state.settings.scripts.chains[chainId];
    delete state.settings.scripts[chainId]; // its flat options slot
    pushSettings(state, [
      { path: ['scripts', 'chains', chainId], remove: true },
      { path: ['scripts', chainId], remove: true },
    ]);
  });

/**
 * Remove an alt from the active profile only. The cross-server identity
 * stays in shared.alts so other profiles can still use it. Tags are
 * per-server, so we drop the username from any tag here as well.
 */
export const deleteAlt = (username: string) =>
  set((state) => {
    if (!username) return;

    const index = state.alts.findIndex((alt) => alt.username === username);
    if (index !== -1) state.alts.splice(index, 1);

    if (state.settings.altData) delete state.settings.altData[username];
    for (const tag of state.settings.altTags ?? []) {
      tag.alts = tag.alts.filter((u) => u !== username);
    }
    pushSettings(state, [{ path: ['altData'] }, { path: ['altTags'] }]);
  });

export const updateAppSetting = (key: string, value: unknown) => {
  const state = useSettingsStore.getState();
  if (Object.is((state.appSettings as Record<string, unknown>)[key], value))
    return;
  if (state.selectedProfileId !== null) {
    window.messenger.profileAction(
      state.selectedProfileId,
      'APPSETTINGS_UPDATE',
      { key, value },
    );
    return;
  }
  if (isProfileSpecificSetting(key)) return;
  set((draft) => {
    draft.appSettings[key] = value;
  });
  //window.ipcRenderer.action('SET_SHARED_APPSETTING', { key, value });
};

/**
 * Switch the active server/profile by id. ONLY the global `server` pointer
 * changes — never ip/port or any other key. Those are profile-specific and
 * belong to the target profile; main loads them when it switches (and the
 * renderer receives the target profile snapshot). Carrying the new profile's
 * ip in here used to corrupt the outgoing profile, because main persists the
 * incoming settings against the still-active (old) profile before switching.
 */
export const switchServer = (id: string) => {
  if (!id) return;
  const { appSettings, selectedProfileKey } = useSettingsStore.getState();
  if (selectedProfileKey === id) return;
  const nextAppSettings = { ...appSettings, server: id as ServerTypes };
  persistSelectedProfileKey(id);
  window.ipcRenderer.action('SET_DEFAULT_PROFILE', id);
  set((state) => {
    state.selectedProfileKey = id;
    state.appSettings = nextAppSettings;
    state.ready = false;
    state.activeScripts = {};
    state.activeBots = [];
    state.activeScriptActions = {};
    state.selectedBot = null;
  });
};

/**
 * Single entry point for persisting plugin metadata: updates the store's
 * macros list and fires SAVE_MACRO_INFO. Callers that only fire the IPC
 * leave the store stale, so prefer this over hand-rolling the pair.
 */
export const savePlugin = (plugin: MacroInfo) =>
  set((state) => {
    if (!plugin?.pluginId) return;
    const i = state.macros.list.findIndex(
      (m) => m.pluginId === plugin.pluginId,
    );
    if (i >= 0) state.macros.list[i] = plugin;
    else state.macros.list.unshift(plugin);
    window.ipcRenderer.action('SAVE_MACRO_INFO', plugin);
  });

export const removeCooldown = (data: string) =>
  set((state) => {
    if (!data) return console.log('Invalid cooldown data', data);
    const cooldowns = (state.settings.reminders ??= []);
    const index = cooldowns.findIndex((cooldown) => cooldown.id === data);
    if (index !== -1) {
      cooldowns.splice(index, 1);
      pushSettings(state, [{ path: ['reminders'] }]);
    }
  });

export const setCooldown = (data: Reminder) =>
  set((state) => {
    if (!data?.id) return console.log('Invalid cooldown data', data);
    const cooldowns = (state.settings.reminders ??= []);
    const index = cooldowns.findIndex((c) => c.id === data.id);
    // Guard against a stale id: cooldowns[-1] = ... would corrupt the array
    // rather than update the intended cooldown.
    if (index === -1) return console.log('Cooldown not found', data.id);
    state.settings.reminders[index] = { ...data };
    pushSettings(state, [{ path: ['reminders', index] }]);
  });

export const addSchedule = (data: import('../../common/cooldowns').ScriptSchedule) =>
  set((state) => {
    (state.settings.reminders ??= []).push(data);
    pushSettings(state, [{ path: ['reminders'] }]);
  });

/**
 * Toggle a cooldown's auto-run opt-in. Persisted on the cooldown so the main
 * process auto-runs the owning plugin (incl. headless) once the cooldown is
 * over — see ScriptHandler.tickCooldowns.
 */
export const toggleAutoStartCooldown = (id: string) =>
  set((state) => {
    if (!id) return;
    const index = state.settings.reminders?.findIndex((c) => c.id === id) ?? -1;
    if (index === -1) return;
    const cooldown = state.settings.reminders![index];
    cooldown.autoStart = !cooldown.autoStart;
    pushSettings(state, [{ path: ['reminders', index, 'autoStart'] }]);
  });

/** Insert or replace a trigger rule (matched by id). */
export const saveTrigger = (trigger: Trigger) =>
  set((state) => {
    const triggers = state.settings.triggers ?? [];
    const index = triggers.findIndex((t) => t.id === trigger.id);
    state.settings.triggers =
      index === -1
        ? [...triggers, trigger]
        : triggers.map((t, i) => (i === index ? trigger : t));
    pushSettings(state, [{ path: ['triggers'] }]);
  });

export const deleteTrigger = (id: string) =>
  set((state) => {
    state.settings.triggers = (state.settings.triggers ?? []).filter(
      (t) => t.id !== id,
    );
    pushSettings(state, [{ path: ['triggers'] }]);
  });

/**
 * Apply requested alt additions, removals, and partial updates to the active
 * server. Fields omitted from an existing alt update are left untouched.
 */
export const applyAltUpdates = (data: AltUpdates) =>
  set((state) => {
    if (!data || Object.keys(data).length === 0) return;
    let removedAlt = false;
    for (const [username, u] of Object.entries(data)) {
      const index = state.alts.findIndex((a) => a.username === username);
      if (u === null) {
        if (index < 0) continue;
        state.alts.splice(index, 1);
        removedAlt = true;
        for (const tag of state.settings.altTags ?? []) {
          tag.alts = tag.alts.filter((name) => name !== username);
        }
        continue;
      }

      if (index < 0) {
        if (typeof u.password !== 'string' || u.password.length === 0) continue;
        state.alts.push({
          username,
          data: {
            premium: false,
            password: u.password,
            gkits: { ...(u.gkits ?? {}) },
            ranks: Object.fromEntries(
              Object.entries(u.ranks ?? {}).filter(([, rank]) => rank != null),
            ) as Record<string, string>,
          },
        });
        continue;
      }

      const a = state.alts[index];
      const slot: ServerAltInfo = (a.data ??= { gkits: {}, ranks: {} });
      slot.premium ??= false;
      slot.gkits ??= {};
      slot.ranks ??= {};

      if (typeof u.password === 'string' && u.password.length > 0) {
        slot.password = u.password;
      }
      if (u.ranks) {
        for (const [gamemode, rank] of Object.entries(u.ranks)) {
          if (rank == null) delete slot.ranks[gamemode];
          else slot.ranks[gamemode] = rank;
        }
      }
      if (u.gkits) {
        for (const [gamemode, list] of Object.entries(u.gkits)) {
          slot.gkits[gamemode] = list;
        }
      }
    }
    pushAlts(state);
    if (removedAlt) {
      pushSettings(state, [{ path: ['altTags'] }]);
    }
  });

export const setAltTags = (tags: AltTag[]) =>
  set((state) => {
    if (!Array.isArray(tags)) return;
    state.settings.altTags = tags.map((t) => ({
      ...t,
      alts: Array.from(new Set(t.alts ?? [])),
    }));
    pushSettings(state, [{ path: ['altTags'] }]);
  });

export const upsertAltTag = (tag: AltTag) =>
  set((state) => {
    if (!tag?.id || !tag.name) return;
    const tags = (state.settings.altTags ??= []);
    const index = tags.findIndex((t) => t.id === tag.id);
    const next: AltTag = { ...tag, alts: Array.from(new Set(tag.alts ?? [])) };
    if (index === -1) tags.push(next);
    else tags[index] = next;
    pushSettings(state, [{ path: ['altTags'] }]);
  });

export const deleteAltTag = (tagId: string) =>
  set((state) => {
    if (!tagId || !state.settings.altTags) return;
    const index = state.settings.altTags.findIndex((tag) => tag.id === tagId);
    if (index === -1) return;
    state.settings.altTags.splice(index, 1);
    pushSettings(state, [{ path: ['altTags'] }]);
  });

export const addAltsToTag = ({
  tagId,
  usernames,
}: {
  tagId: string;
  usernames: string[];
}) =>
  set((state) => {
    if (!tagId || !Array.isArray(usernames) || usernames.length === 0) return;
    const tag = state.settings.altTags?.find((t) => t.id === tagId);
    if (!tag) return;
    const existing = new Set(tag.alts);
    for (const u of usernames) {
      if (!existing.has(u)) {
        tag.alts.push(u);
        existing.add(u);
      }
    }
    pushSettings(state, [{ path: ['altTags'] }]);
  });

export const removeAltsFromTag = ({
  tagId,
  usernames,
}: {
  tagId: string;
  usernames: string[];
}) =>
  set((state) => {
    if (!tagId || !Array.isArray(usernames) || usernames.length === 0) return;
    const tag = state.settings.altTags?.find((t) => t.id === tagId);
    if (!tag) return;
    const drop = new Set(usernames);
    tag.alts = tag.alts.filter((u) => !drop.has(u));
    pushSettings(state, [{ path: ['altTags'] }]);
  });

export const setTagAlts = ({
  tagId,
  alts,
}: {
  tagId: string;
  alts: string[];
}) =>
  set((state) => {
    if (!tagId || !Array.isArray(alts)) return;
    const tag = state.settings.altTags?.find((t) => t.id === tagId);
    if (!tag) return;
    tag.alts = Array.from(new Set(alts));
    pushSettings(state, [{ path: ['altTags'] }]);
  });

export const setLauncherOptions = (data: LaunchMinecraftOptions) =>
  set((state) => {
    if (!data) return console.error('No launcher options provided');
    state.launcherOptions = data;
    pushShared({ launcherOptions: data });
  });
