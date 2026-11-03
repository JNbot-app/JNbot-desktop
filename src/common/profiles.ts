import type {
  JNdata,
  JNdataDataSection,
  JNdataServer,
} from '../main/src/types';
import type {
  ProfileScript,
  ProfileScriptBundle,
  ProfileScriptList,
} from './profileScripts';

/**
 * Every server is a profile in the user's profiles list. Profiles installed
 * from an official (JNbot-published) marketplace share are the built-in,
 * read-only servers; everything else is user-editable. There is no
 * hard-coded list of built-in ids, so servers can be added at any time
 * without an app release (see `mergeProfilesIntoJNdata` and `getServerMeta`).
 */
export const PROFILES_VERSION = 1;

export interface CustomProfile {
  /** Used as the server id. Lowercase, no spaces. */
  id: string;
  /**
   * Built-in profile this copy follows. When present, the current JNdata
   * source replaces the stored snapshot at merge time while this profile's
   * local identity remains unchanged.
   */
  sourceProfileId?: string;
  /** Source identity for a full profile copied from another JNbot runtime. */
  remoteSource?: {
    ownerId: string;
    profileKey: string;
    revision: string;
  };
  /**
   * Share this profile was installed from. Official (JNbot-published)
   * profiles are the built-in, read-only servers.
   */
  share?: { id: string; official: boolean };
  predefined: false;
  createdAt: number;
  updatedAt: number;
  data: JNdataDataSection;
  gamemodes: JNdataServer;
  /**
   * Profile-attached scripts. Stored on the profile (not on `data`) so it's
   * easy to find when iterating profiles; `mergeProfilesIntoJNdata` copies
   * this list onto `data.scripts` in the merged JNdata.
   */
  scripts?: ProfileScriptList;
  /**
   * Optional plugin reference that renders the player-profile drawer for
   * this server. Same plumbing as `scripts[i]` — info+code resolved via
   * `ProfileScripts_.resolve`, runs in a sandboxed evaluator on the main
   * side, returns JSON the renderer maps to sections.
   */
  profileUiAction?: ProfileScript;
  /**
   * Optional plugin reference loaded as the *last* plugin in
   * every bot worker for this server. Same plumbing as
   * `profileUiAction` — resolved via `ProfileScripts_` and shipped to
   * the worker via `WorkerDataType.botExtension`.
   */
  botExtensionAction?: ProfileScript;
  /** Plugin ids that cannot run while this profile is active. */
  disallowedPlugins?: string[];
  /**
   * Inlined script payloads — only populated on exported profile files so
   * the importer can reconstruct the scripts (and the profile-UI action)
   * without network access. NOT persisted in the runtime profiles.json.
   */
  scriptBundles?: ProfileScriptBundle[];
}

export interface ProfilesFile {
  version: number;
  profiles: CustomProfile[];
}

/**
 * Profile-level fields that live on the CustomProfile but are promoted onto
 * `data` in the merged JNdata, so the dashboard / drawer can read everything
 * from `JNdata.data[server]`. Declared once here so merging (promote onto
 * `data`) and cloning (lift back off `data`) stay in sync — add a field here
 * and both pick it up automatically.
 */
export const PROMOTED_PROFILE_FIELDS = [
  'scripts',
  'profileUiAction',
  'botExtensionAction',
  'disallowedPlugins',
] as const satisfies readonly (keyof CustomProfile & keyof JNdataDataSection)[];

/** Whether an active profile blocks a plugin id from executing. */
export function isPluginDisallowed(
  profile: Pick<JNdataDataSection, 'disallowedPlugins'> | null | undefined,
  pluginId: string | null | undefined,
): boolean {
  return !!pluginId && (profile?.disallowedPlugins ?? []).includes(pluginId);
}

/**
 * Merge custom profiles into a JNdata object. The fetched/predefined entries
 * keep their place at the start of `serverList`; custom ids are appended.
 * Returns a new JNdata — does not mutate inputs.
 */
export function mergeProfilesIntoJNdata(
  base: JNdata,
  profiles: CustomProfile[],
): JNdata {
  const customIds = profiles.filter((p) => p?.id).map((p) => p.id);
  const customSet = new Set<string>(customIds);

  // Built-in servers are every entry in the fetched JNdata the user hasn't
  // shadowed with a custom profile of the same id.
  const baseList = (base.serverList ?? []).filter((id) => !customSet.has(id));

  const data: Record<string, JNdataDataSection> = {};
  const servers: Record<string, JNdataServer> = {};

  for (const id of baseList) {
    if (base.data?.[id]) data[id] = base.data[id];
    if (base.servers?.[id]) servers[id] = base.servers[id];
  }

  for (const p of profiles) {
    if (!p?.id || p.sourceProfileId) continue;
    // Promote the profile-level fields (PROMOTED_PROFILE_FIELDS) onto `data` so
    // the dashboard / drawer can read everything from JNdata.data[server].
    const promoted: Partial<JNdataDataSection> = {};
    for (const key of PROMOTED_PROFILE_FIELDS) {
      if (p[key] != null) promoted[key] = p[key] as never;
    }
    data[p.id] = { ...p.data, ...promoted, ...(p.share?.official ? { official: true } : {}) };
    servers[p.id] = p.gamemodes ?? {};
  }

  // Copies that follow another (usually official) profile take its current data.
  for (const p of profiles) {
    if (!p?.id || !p.sourceProfileId) continue;
    const sourceData = data[p.sourceProfileId] ?? base.data?.[p.sourceProfileId];
    if (sourceData) {
      const { official: _official, ...followed } = sourceData;
      data[p.id] = { ...followed, id: p.id, name: p.data.name, shortName: p.data.shortName };
      servers[p.id] = servers[p.sourceProfileId] ?? base.servers?.[p.sourceProfileId] ?? p.gamemodes ?? {};
    } else {
      data[p.id] = p.data;
      servers[p.id] = p.gamemodes ?? {};
    }
  }

  return {
    ...base,
    serverList: [...baseList, ...customIds],
    data,
    servers,
  };
}

/** Default scaffold for a brand-new profile. */
export function makeEmptyProfile(id: string = ''): CustomProfile {
  const now = Date.now();
  return {
    id,
    predefined: false,
    createdAt: now,
    updatedAt: now,
    data: {
      name: '',
      shortName: '',
      id,
      icon: null,
      color: '#E6BF4C',
      defaultIp: '',
      defaultPort: 25565,
      ips: [],
      onlineMode: false,
      gamemodes: [],
      kitGamemodes: [],
      defaultGamemode: '',
      joinBehaviours: {},
    },
    gamemodes: {},
    scripts: [],
  };
}

/**
 * Build a custom profile from an existing JNdata server id (used for cloning
 * a predefined server into an editable profile).
 */
export function profileFromJNdata(
  jndata: JNdata,
  sourceId: string,
  newId: string,
  newName?: string,
): CustomProfile {
  const empty = makeEmptyProfile(newId);
  const sourceData = jndata?.data?.[sourceId];
  const sourceGamemodes = jndata?.servers?.[sourceId];

  if (!sourceData) return empty;

  // Deep-clone the whole section so the new profile shares no references with
  // the source. Spreading `clonedData` means any field added to
  // JNdataDataSection is carried over automatically.
  const clonedData = structuredClone(sourceData);

  // Lift the promoted profile-level fields back off `data` onto the profile —
  // the inverse of mergeProfilesIntoJNdata.
  const promoted: Partial<CustomProfile> = {};
  for (const key of PROMOTED_PROFILE_FIELDS) {
    if (clonedData[key] != null) {
      promoted[key] = clonedData[key] as never;
      delete clonedData[key];
    }
  }

  const data: JNdataDataSection = {
    ...clonedData,
    id: newId,
    name: newName ?? `${sourceData.name} (copy)`,
    shortName: sourceData.shortName ?? newId,
  };

  return {
    ...empty,
    ...promoted,
    data,
    gamemodes: structuredClone(sourceGamemodes ?? {}),
  };
}

/**
 * Random id for a new profile. Ids never derive from the name, so a local
 * profile cannot collide with one installed from a share.
 */
export function generateProfileId(reservedIds: readonly string[] = []): string {
  const reserved = new Set(reservedIds);
  for (;;) {
    const id = `p${Math.random().toString(36).slice(2, 12)}`;
    if (!reserved.has(id)) return id;
  }
}

/**
 * Convert a user-facing gamemode label ("FactionsImmortal", "SkyblockDream")
 * into the lowercase, space-stripped key used in `servers[id]`. Must match
 * how the rest of the app reads gamemode data in account profiles and stats.
 */
export function gamemodeKey(label: string): string {
  return (label ?? '').toLowerCase().replace(/\s+/g, '');
}

/** Keep only the entries of `obj` whose key is in `keep`. Returns a new object. */
function pickByKeys<T>(
  obj: Record<string, T>,
  keep: Set<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => keep.has(k)),
  );
}

/**
 * Prune every gamemode-keyed field down to the canonical gamemode list
 * (`data.gamemodes`). A gamemode is referenced in several places — the kit
 * list and default selection (raw labels), and join behaviours plus the
 * per-gamemode ranks/gkits map (keyed by `gamemodeKey`). Removing a gamemode
 * from one spot used to leave the others dangling.
 *
 * Funnel the profile through this single normaliser (e.g. on save) and a
 * stale reference can no longer be persisted, no matter which wizard step
 * edited what. Returns a new profile; does not mutate the input.
 */
export function normalizeProfileGamemodes(
  profile: CustomProfile,
): CustomProfile {
  const gamemodes = profile.data.gamemodes ?? [];
  const validLabels = new Set(gamemodes);
  const validKeys = new Set(gamemodes.map(gamemodeKey));

  return {
    ...profile,
    disallowedPlugins: [...new Set((profile.disallowedPlugins ?? []).filter(Boolean))],
    data: {
      ...profile.data,
      // Stored as raw labels.
      kitGamemodes: (profile.data.kitGamemodes ?? []).filter((g) =>
        validLabels.has(g),
      ),
      defaultGamemode: validLabels.has(profile.data.defaultGamemode)
        ? profile.data.defaultGamemode
        : (gamemodes[0] ?? ''),
      // Keyed by gamemodeKey(label).
      joinBehaviours: pickByKeys(profile.data.joinBehaviours ?? {}, validKeys),
    },
    // Per-gamemode ranks/gkits map, also keyed by gamemodeKey(label).
    gamemodes: pickByKeys(profile.gamemodes ?? {}, validKeys),
  };
}
