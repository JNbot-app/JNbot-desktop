import type {
  JNdata,
  JNdataDataSection,
  JNdataServer,
} from '../main/src/types';
import { isOnlineMode } from './serverAuthentication';

export interface ServerMeta {
  id: string;
  name: string;
  shortName: string;
  icon: string | null;
  color: string;
  defaultIp: string;
  defaultPort: number;
  ips: string[];
  gamemodes: string[];
  kitGamemodes: string[];
  defaultGamemode: string;
  /** True when this server requires Microsoft authentication. */
  onlineMode: boolean;
  /** True for user-defined profiles, false for servers shipped in JNdata. */
  custom: boolean;
  /** Inverse of `custom` — true for built-in servers fetched from JNdata. */
  predefined: boolean;
}

const FALLBACK_COLOR = '#8C8C8C';

/**
 * Pulls server metadata from JNdata. Looks in `data[id]` first (canonical
 * location), then `servers[id]` as a fallback for legacy entries that kept
 * display metadata alongside their gamemode map.
 */
export function getServerMeta(
  jndata: JNdata | undefined | null,
  id: string,
  customIds?: readonly string[],
): ServerMeta {
  const data: Partial<JNdataDataSection> = jndata?.data?.[id] ?? {};
  const server: Record<string, any> = (jndata?.servers?.[id] as Record<
    string,
    any
  >) ?? {};

  const pick = <T,>(key: string, fallback: T): T => {
    const fromData = (data as any)[key];
    if (fromData !== undefined && fromData !== null) return fromData as T;
    const fromServer = server[key];
    if (fromServer !== undefined && fromServer !== null) return fromServer as T;
    return fallback;
  };

  // A server is custom when it is one of the user's profiles and was not
  // installed from an official share. Callers without the custom-id set treat
  // the server as built-in.
  const custom = !!customIds && customIds.includes(id) && !data.official;
  return {
    id,
    name: pick('name', id),
    shortName: pick('shortName', id),
    icon: pick<string | null>('icon', null),
    color: pick('color', FALLBACK_COLOR),
    defaultIp: pick('defaultIp', ''),
    defaultPort: pick('defaultPort', 25565),
    ips: pick('ips', []),
    gamemodes: pick('gamemodes', []),
    kitGamemodes: pick('kitGamemodes', []),
    defaultGamemode: pick('defaultGamemode', ''),
    onlineMode: isOnlineMode(data),
    custom,
    predefined: !custom,
  };
}

export function getServerList(jndata: JNdata | undefined | null): string[] {
  return jndata?.serverList ?? [];
}

export function getAllServerMeta(
  jndata: JNdata | undefined | null,
): ServerMeta[] {
  return getServerList(jndata).map((id) => getServerMeta(jndata, id));
}

/** Server metadata for every installed profile, in JNdata order. */
export function getInstalledServerMeta(
  jndata: JNdata | undefined | null,
  customIds: string[] = [],
): ServerMeta[] {
  return getServerList(jndata).map((id) => getServerMeta(jndata, id, customIds));
}

/**
 * Returns the gamemode->ranks/gkits map for a server, stripping out any
 * non-object metadata that may live alongside the gamemodes in the JSON.
 */
export function getServerGamemodeMap(
  jndata: JNdata | undefined | null,
  id: string,
): JNdataServer {
  const raw = jndata?.servers?.[id];
  if (!raw || typeof raw !== 'object') return {};
  const out: JNdataServer = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && 'ranks' in value && 'gkits' in value) {
      out[key] = value;
    }
  }
  return out;
}

export function defaultIpForServer(
  jndata: JNdata | undefined | null,
  id: string,
): string {
  return getServerMeta(jndata, id).defaultIp;
}
