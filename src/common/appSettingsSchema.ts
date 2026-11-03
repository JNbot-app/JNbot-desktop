import type { AppSettings } from '../main/src/types';
import { normalizeProxyConfig } from './proxyConfig';

/**
 * The single source of truth for which `AppSettings` keys are stored **per
 * profile** (inside the active server's settings file) rather than globally
 * (in the appSettings file).
 *
 * Everything that needs to know "is this setting profile-specific?" derives it
 * from this one list:
 *   - the renderer settings schema flags each setting with it
 *     (see `settingsSchema.tsx`),
 *   - the Profile Wizard renders exactly these settings so a profile creator
 *     can pick their defaults (stored on `data.appSettingsDefaults`),
 *   - the main process splits writes between global values and the
 *     app-settings store's profile override index, then merges them on read
 *     (see `Settings.ts`).
 *
 * Add a key here and the whole pipeline picks it up automatically — no other
 * place needs to change. The keys correspond to entries in the renderer
 * settings schema; their default values keep living in that schema, so there
 * is no duplication of defaults.
 */
export const PROFILE_SPECIFIC_APP_SETTINGS = [
  'version',
  'ip',
  'port',
  'serverIpRotation',
  'retryOnLoginFail',
  'joinServerTimeout',
  'auto_v4guard',
  'autoResourcePackAccept',
  'kickBehaviour',
  'proxy',
  'join_delay',
  'join_delay_premium',
  'delay_between_actions',
] as const;

export type ProfileSpecificKey = (typeof PROFILE_SPECIFIC_APP_SETTINGS)[number];

const PROFILE_KEY_SET: ReadonlySet<string> = new Set(
  PROFILE_SPECIFIC_APP_SETTINGS,
);

/** True when a setting key is stored per profile rather than globally. */
export function isProfileSpecificSetting(key: string): boolean {
  return PROFILE_KEY_SET.has(key);
}

/** Keep only the profile-specific keys from an app-settings-shaped object. */
export function pickProfileSpecific(
  settings: Partial<AppSettings> | undefined | null,
): Partial<AppSettings> {
  const out = {} as Record<string, unknown>;
  if (!settings) return out as Partial<AppSettings>;
  const src = settings as Record<string, unknown>;
  for (const key of PROFILE_SPECIFIC_APP_SETTINGS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out as Partial<AppSettings>;
}

/**
 * Split a full app-settings object into the part stored globally and the part
 * stored on the active profile. The union of the two is the original object.
 */
export function splitAppSettings(settings: AppSettings): {
  global: AppSettings;
  profile: Partial<AppSettings>;
} {
  const global: Record<string, unknown> = {};
  const profile = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(settings)) {
    if (isProfileSpecificSetting(key)) profile[key] = value;
    else global[key] = value;
  }
  return { global: global as AppSettings, profile: profile as Partial<AppSettings> };
}

/**
 * Build the effective app settings the rest of the app sees, layering (last
 * wins, but only for profile-specific keys):
 *   1. the global app-settings file (base — also the fallback for any
 *      profile-specific key not set anywhere else),
 *   2. the profile creator's chosen defaults (`data.appSettingsDefaults`),
 *   3. the user's per-profile overrides from the app-settings store.
 */
export function mergeProfileAppSettings(
  global: AppSettings,
  profileDefaults: Partial<AppSettings> | undefined | null,
  profileOverrides: Partial<AppSettings> | undefined | null,
): AppSettings {
  const merged = {
    ...global,
    ...pickProfileSpecific(profileDefaults),
    ...pickProfileSpecific(profileOverrides),
  };
  if (merged.proxy !== undefined) merged.proxy = normalizeProxyConfig(merged.proxy);
  return merged;
}
