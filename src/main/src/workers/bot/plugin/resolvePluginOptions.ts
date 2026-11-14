import type { MacroInfo } from '../../../types';
import {
  DEFAULT_PRESET,
  pluginPresets,
  presetValues,
  selectedPresetId,
} from '../../../../../common/pluginPresets';
import workerScript from '../../lib/workerScript';

const hasValue = (value: unknown) => value !== undefined && value !== '';

export function resolvePluginOptions(
  plugin: MacroInfo,
  overrides: Record<string, any> = {},
): Record<string, any> {
  const definitions =
    plugin.config?.flatMap((section) => section.options) ?? [];
  const stored = global.settings?.scripts?.[plugin.pluginId];
  const presetId = selectedPresetId(stored, overrides);
  if (presetId !== DEFAULT_PRESET && !pluginPresets(stored)[presetId])
    global.log(
      `The preset of ${plugin.name} no longer exists, using Default`,
      'warning',
    );
  const saved = presetValues(stored, presetId);
  const values: Record<string, any> = {};
  let invalid = false;

  for (const definition of definitions) {
    const directValue = hasValue(overrides[definition.id])
      ? overrides[definition.id]
      : saved[definition.id];
    let value = directValue;

    if (definition.valueByFieldId && typeof directValue === 'object') {
      const dependency = definitions.find(
        (option) => option.id === definition.valueByFieldId,
      );
      const selected = dependency
        ? (hasValue(overrides[dependency.id])
            ? overrides[dependency.id]
            : saved[dependency.id]) ?? dependency.defaultValue
        : undefined;
      const key = String(selected).toLowerCase();
      const inherited = saved[definition.id];
      value = hasValue(selected)
        ? directValue?.[key] ??
          (typeof inherited === 'object' ? inherited?.[key] : undefined)
        : undefined;
    }

    value ??= definition.defaultValue;
    if (definition.required && !hasValue(value)) {
      invalid = true;
      workerScript.optionError(
        { field: definition.id, message: 'This field is required' },
        plugin,
      );
    }
    values[definition.id] = value;
  }

  if (invalid) {
    global.log('Plugin has missing required options', 'error');
    workerScript.stop();
  }
  return values;
}

export default resolvePluginOptions;
