import type { CreateProfileInput } from './mobileClientContract';
import { parseProfileAdvanced, type ProfilePluginChoice } from './profileCreation';
import { gamemodeKey, generateProfileId, makeEmptyProfile, normalizeProfileGamemodes } from './profiles';

/** Profiles need a gamemode; the quick-create form gets one bots are already in on connect. */
export const DEFAULT_GAMEMODE = 'Hub';
import { pickProfileSpecific } from './appSettingsSchema';

/** Shared creation path for the trusted local client event. Never writes active settings. */
export function createCustomProfile(input: CreateProfileInput, reservedIds: string[], plugins: readonly ProfilePluginChoice[]) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const host = typeof input?.host === 'string' ? input.host.trim() : '';
  const port = Number(input?.port);
  if (!name || !host) throw new Error('Enter a profile name and Minecraft server address.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a port between 1 and 65535.');
  const advanced = input.advanced === undefined ? {} : parseProfileAdvanced(input.advanced, plugins);
  const id = generateProfileId(reservedIds);
  const hasGamemodes = Boolean(advanced.gamemodes?.length);
  const profile = makeEmptyProfile(id);
  profile.data = {
    ...profile.data,
    id,
    name,
    shortName: advanced.shortName || name.slice(0, 24),
    icon: advanced.icon ?? profile.data.icon,
    color: advanced.color ?? profile.data.color,
    defaultIp: host,
    defaultPort: port,
    ips: [...new Set([host, ...(advanced.ips ?? [])])],
    onlineMode: input.onlineMode === true,
    gamemodes: hasGamemodes ? advanced.gamemodes! : [DEFAULT_GAMEMODE],
    kitGamemodes: advanced.kitGamemodes ?? [],
    defaultGamemode: advanced.defaultGamemode ?? '',
    joinBehaviours: hasGamemodes
      ? advanced.joinBehaviours ?? {}
      : { [gamemodeKey(DEFAULT_GAMEMODE)]: { kind: 'direct' } },
  };
  if (advanced.appSettingsDefaults && Object.keys(advanced.appSettingsDefaults).length) {
    profile.data.appSettingsDefaults = pickProfileSpecific(advanced.appSettingsDefaults);
  }
  profile.gamemodes = advanced.ranksGkits ?? {};
  profile.scripts = advanced.scripts ?? [];
  profile.disallowedPlugins = advanced.disallowedPlugins;
  profile.botExtensionAction = advanced.botExtensionAction;
  return normalizeProfileGamemodes(profile);
}
