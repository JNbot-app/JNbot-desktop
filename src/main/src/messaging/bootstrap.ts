import type Settings from '../functions/Settings';
import type { JNdata, Stats } from '../types';
import {
  FULL_REMOTE_PERMISSIONS,
  USE_ACCOUNTS,
  hasRemotePermission,
  remoteAccessCapabilities,
  unrestrictedPermissions,
  type ClientPermissions,
  type ClientPrincipal,
} from '../../../common/clientPermissions';
import { REMOTE_PROTOCOL_VERSION } from '../../../common/remoteProtocol';

/**
 * Creates the transport-neutral initial snapshot consumed by desktop, remote
 * and embedded-mobile clients.  Platform code only supplies a principal and a
 * frame transport; profile filtering stays in one place.
 */
export function createClientBootstrap(
  settings: Settings,
  principal: ClientPrincipal = {
    kind: 'trusted-local',
    subjectId: 'local',
    permissions: unrestrictedPermissions(),
  },
) {
  const { permissions, allowed, allowedAlts, allowedSet } = resolveClientScope(settings, principal);
  const jndata = settings.JNdata;
  const filteredJNdata: JNdata = {
    ...jndata,
    serverList: jndata.serverList.filter((key) => allowedSet.has(key)),
    servers: Object.fromEntries(Object.entries(jndata.servers).filter(([key]) => allowedSet.has(key))),
    data: Object.fromEntries(Object.entries(jndata.data).filter(([key]) => allowedSet.has(key))),
  };
  const stats = filterStats(settings.stats.stats, allowed, allowedAlts);

  return {
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    capabilities: [
      'profiles', 'scripts', 'plugins', 'bot-chat', 'bot-inventory',
      'alts.manage', 'bot-actions', 'bot-movement', 'bot-info',
      'profiles.local-catalog',
      'profiles.portable-sync',
      'plugins.portable-sync',
      'instance.direct-transfer',
      'remote.permission-mask',
      'remote.access-capabilities',
    ],
    permissions: {
      permissionMask: permissions.permissionMask,
      capabilities: remoteAccessCapabilities(permissions.permissionMask),
    },
    jndata: filteredJNdata,
    profiles: settings.profiles.list.filter((profile) => allowedSet.has(profile.id)),
    appSettings: { ...settings.sharedAppSettings, server: allowed[0] },
    shared: {
      ...settings.shared,
      alts: settings.shared.alts.filter((alt) => allowedAlts.has(alt.username)),
      devices: [],
    },
    stats,
  };
}

/** A compact, profile-filtered snapshot for live remote statistics updates. */
export function createClientStatsSnapshot(
  settings: Settings,
  principal: ClientPrincipal,
): Stats {
  const { allowed, allowedAlts } = resolveClientScope(settings, principal);
  return filterStats(settings.stats.stats, allowed, allowedAlts);
}

function resolveClientScope(settings: Settings, principal: ClientPrincipal) {
  const permissions: ClientPermissions = principal.kind === 'remote'
    ? settings.shared.devices.find((device) => device.id === principal.subjectId)?.permissions ?? principal.permissions
    : principal.permissions;
  const available = settings.getAvailableProfiles().map((profile) => profile.server);
  const allowed = permissions.permissionMask === FULL_REMOTE_PERMISSIONS ||
    permissions.profiles === '*'
    ? available
    : available.filter((key) => permissions.profiles.includes(key));
  const allowedAlts = new Set<string>();
  if (hasRemotePermission(permissions.permissionMask, USE_ACCOUNTS)) {
    for (const profileKey of allowed) {
      for (const username of Object.keys(settings.getProfileSettings(profileKey).altData ?? {}))
        allowedAlts.add(username);
    }
  }
  return { permissions, allowed, allowedSet: new Set(allowed), allowedAlts };
}

function filterStats(stats: Stats, profileKeys: string[], allowedAlts: Set<string>): Stats {
  const filtered: Stats = { alts: {}, scripts: stats.scripts };
  let allAlts = true;
  for (const [username, value] of Object.entries(stats.alts)) {
    if (allowedAlts.has(username)) filtered.alts[username] = value;
    else allAlts = false;
  }
  // History is aggregated over every alt, so only share it with full alt access.
  if (allAlts) filtered.history = stats.history;
  for (const profileKey of profileKeys) {
    if (stats[profileKey] !== undefined) filtered[profileKey] = stats[profileKey];
  }
  return filtered;
}
