/**
 * Presets: named sets of a plugin's option values. They live in the plugin's
 * own slot, `settings.scripts[pluginId]`, whose flat values are the "Default"
 * preset. `$preset` holds the selected preset; passing it as an option override
 * picks another one for a single run. Shared by the desktop renderer, the
 * backend, the workers and the mobile client.
 */

export const PRESET_OPTION = '$preset';
export const PRESETS_KEY = '$presets';
export const DEFAULT_PRESET = 'default';
/** How many instances of one script can run at once. */
export const MAX_SCRIPT_INSTANCES = 8;

export type PluginPreset = { name: string; values: Record<string, any> };
type StoredOptions = Record<string, any> | null | undefined;
type Overrides = Record<string, any> | null | undefined;

export const pluginPresets = (
  stored: StoredOptions,
): Record<string, PluginPreset> => stored?.[PRESETS_KEY] ?? {};

/** The preset a run uses: its override, else the plugin's selected preset. */
export const selectedPresetId = (
  stored: StoredOptions,
  overrides?: Overrides,
): string =>
  overrides?.[PRESET_OPTION] ?? stored?.[PRESET_OPTION] ?? DEFAULT_PRESET;

/** Id of the preset with this id or (case-insensitive) name, if there is one. */
export function findPresetId(
  stored: StoredOptions,
  preset: string,
): string | undefined {
  const name = preset.toLowerCase();
  if (name === DEFAULT_PRESET) return DEFAULT_PRESET;
  const presets = pluginPresets(stored);
  if (presets[preset]) return preset;
  return Object.keys(presets).find(
    (id) => presets[id].name.toLowerCase() === name,
  );
}

/** A preset's option values; a preset that no longer exists reads as Default. */
export function presetValues(
  stored: StoredOptions,
  presetId = selectedPresetId(stored),
): Record<string, any> {
  const {
    [PRESET_OPTION]: _selected,
    [PRESETS_KEY]: presets,
    ...defaults
  } = stored ?? {};
  return presets?.[presetId]?.values ?? defaults;
}

/** Settings path of an option: inside the selected preset, else the flat slot. */
export function presetOptionPath(
  stored: StoredOptions,
  pluginId: string,
  optionId: string,
): string[] {
  const presetId = selectedPresetId(stored);
  return pluginPresets(stored)[presetId]
    ? ['scripts', pluginId, PRESETS_KEY, presetId, 'values', optionId]
    : ['scripts', pluginId, optionId];
}

/** Set or, with `undefined`, clear the preset in a set of option overrides. */
export function withPreset<T extends Record<string, any>>(
  overrides: T,
  presetId?: string,
): T {
  const { [PRESET_OPTION]: _previous, ...rest } = overrides;
  return (presetId ? { ...rest, [PRESET_OPTION]: presetId } : rest) as T;
}
