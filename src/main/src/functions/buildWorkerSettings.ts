import type Settings_ from './Settings';
import type { WorkerSettings } from '../types';

/**
 * Merge a profile's per-server settings with the shared slice into a single
 * object workers see as `global.settings`. Workers don't know (or care)
 * that the underlying files are split.
 */
export function buildWorkerSettings(
  settings: Settings_,
  profileKey = settings.bootstrapProfileKey,
): WorkerSettings {
  const per = settings.getProfileSettings(profileKey);
  const shared = settings.shared;
  return {
    ...per,
    alts: settings.getAltsWithDataForProfile(profileKey),
    devices: shared.devices,
    launcherOptions: shared.launcherOptions,
  };
}
