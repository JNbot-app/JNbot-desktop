import type { MacroInfo } from '../../types';
import type ScriptHandler from '../ScriptHandler';
import {
  isSensitivePluginOption,
  validatePluginOptionSchema,
  type PluginOptionSchema,
} from '../../../../common/pluginOptions';
import {
  DEFAULT_PRESET,
  PRESET_OPTION,
  PRESETS_KEY,
  presetValues,
} from '../../../../common/pluginPresets';

export class McpPluginService {
  constructor(private readonly scriptHandler: ScriptHandler) {}

  getOptions(profileId: number, pluginId: string) {
    const info = this.plugin(pluginId);
    const profileKey = this.scriptHandler.getRuntime(profileId).profileKey;
    const settings = this.scriptHandler.settings.getProfileSettings(profileKey);
    const values = presetValues(settings.scripts?.[pluginId], DEFAULT_PRESET);
    const sensitiveOptionIds = this.sensitiveOptionIds(info.config ?? []);
    for (const id of sensitiveOptionIds) delete values[id];
    const schema = JSON.parse(
      JSON.stringify(info.config ?? []),
    ) as PluginOptionSchema;
    for (const section of schema)
      for (const option of section.options)
        if (sensitiveOptionIds.has(option.id)) delete option.defaultValue;
    return {
      pluginId,
      profileKey,
      scriptType: info.scriptType,
      schema,
      values,
      redactedOptionIds: [...sensitiveOptionIds],
    };
  }

  updateOptions(
    profileId: number,
    pluginId: string,
    values: Record<string, unknown>,
    replace = false,
  ) {
    const info = this.plugin(pluginId);
    const optionIds = new Set(
      (info.config ?? []).flatMap((section) =>
        section.options.map((option) => option.id),
      ),
    );
    const sensitiveOptionIds = this.sensitiveOptionIds(info.config ?? []);
    for (const key of Object.keys(values)) {
      this.assertSafeKey(key);
      if (!optionIds.has(key)) throw new Error(`Unknown plugin option: ${key}`);
      if (sensitiveOptionIds.has(key))
        throw new Error(
          `Sensitive plugin option cannot be changed by AI: ${key}`,
        );
    }
    const profileKey = this.scriptHandler.getRuntime(profileId).profileKey;
    const settings = this.scriptHandler.settings.getProfileSettings(profileKey);
    const current = { ...(settings.scripts?.[pluginId] ?? {}) };
    const next = replace
      ? Object.fromEntries(
          Object.entries(current).filter(
            ([key]) =>
              sensitiveOptionIds.has(key) ||
              key === PRESET_OPTION ||
              key === PRESETS_KEY,
          ),
        )
      : current;
    Object.assign(next, values);
    this.scriptHandler.settings.replaceProfileSettings(profileKey, {
      ...settings,
      scripts: { ...settings.scripts, [pluginId]: next },
    });
    return this.getOptions(profileId, pluginId);
  }

  updateSchema(pluginId: string, schema: unknown): PluginOptionSchema {
    const info = this.plugin(pluginId);
    const validated = validatePluginOptionSchema(schema);
    this.scriptHandler.macros.saveInfo({ ...info, config: validated });
    this.scriptHandler.macros.invalidateLocalCache();
    return validated;
  }

  private plugin(pluginId: string): MacroInfo {
    if (!/^[a-z0-9]+$/i.test(pluginId)) throw new Error('Invalid plugin id.');
    const info = this.scriptHandler.macros.readPluginInfo(pluginId);
    if (!info) throw new Error('Plugin not found.');
    return info;
  }

  private sensitiveOptionIds(schema: PluginOptionSchema): Set<string> {
    return new Set(
      schema.flatMap((section) =>
        section.options
          .filter((option) => isSensitivePluginOption(option))
          .map((option) => option.id),
      ),
    );
  }

  private assertSafeKey(key: string): void {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor')
      throw new Error('Invalid plugin option key.');
  }
}

export default McpPluginService;
