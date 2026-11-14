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
  findPresetId,
  pluginPresets,
  presetValues,
  selectedPresetId,
} from '../../../../common/pluginPresets';
import {
  TRIGGER_ACTION_TYPES,
  TRIGGER_EVENTS,
  newTrigger,
  triggerProblem,
  type Trigger,
} from '../../../../common/triggers';
import { chainPluginId, type ChainStep } from '../../../../common/chains';
import { McpInputError } from '../../../../common/mcp';

export class McpPluginService {
  constructor(private readonly scriptHandler: ScriptHandler) {}

  getOptions(profileId: number, pluginId: string, preset?: string) {
    const info = this.plugin(pluginId);
    const profileKey = this.scriptHandler.getRuntime(profileId).profileKey;
    const settings = this.scriptHandler.settings.getProfileSettings(profileKey);
    const stored = settings.scripts?.[pluginId];
    const presetId = preset ? findPresetId(stored, preset) : DEFAULT_PRESET;
    if (!presetId) throw new Error(`Unknown preset: ${preset}`);
    const values = presetValues(stored, presetId);
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
      preset: presetId,
      presets: [
        { id: DEFAULT_PRESET, name: 'Default' },
        ...Object.entries(pluginPresets(stored)).map(([id, { name }]) => ({ id, name })),
      ],
      selectedPreset: selectedPresetId(stored),
      values,
      redactedOptionIds: [...sensitiveOptionIds],
    };
  }

  updateOptions(
    profileId: number,
    pluginId: string,
    values: Record<string, unknown>,
    replace = false,
    preset?: string,
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
    const stored = structuredClone(settings.scripts?.[pluginId] ?? {});
    let presetId = preset ? findPresetId(stored, preset) : DEFAULT_PRESET;
    // An unknown preset name creates that preset from the Default values.
    if (!presetId) {
      presetId = Math.random().toString(36).slice(2, 10);
      (stored[PRESETS_KEY] ??= {})[presetId] = {
        name: preset!.slice(0, 60),
        values: presetValues(stored, DEFAULT_PRESET),
      };
    }
    const keep = (key: string) =>
      sensitiveOptionIds.has(key) || key === PRESET_OPTION || key === PRESETS_KEY;
    const current: Record<string, unknown> =
      presetId === DEFAULT_PRESET ? stored : stored[PRESETS_KEY][presetId].values;
    if (replace)
      for (const key of Object.keys(current)) if (!keep(key)) delete current[key];
    Object.assign(current, values);
    this.writeSettings(profileKey, (draft) => {
      draft.scripts = { ...draft.scripts, [pluginId]: stored };
    });
    return this.getOptions(profileId, pluginId, presetId);
  }

  // ---------------------------------------------------------------------------
  // Triggers & chains (stored per profile in its settings)
  // ---------------------------------------------------------------------------

  getAutomations(profileKey: string) {
    const settings = this.scriptHandler.settings.getProfileSettings(profileKey);
    const scripts = settings.scripts ?? {};
    return {
      triggers: settings.triggers ?? [],
      chains: Object.values(scripts.chains ?? {}).map((chain: any) => ({
        id: chain.id,
        pluginId: chainPluginId(chain.id),
        steps: chain.chains,
        options: { ...chain.options, ...scripts[chain.id] },
      })),
      triggerEvents: TRIGGER_EVENTS,
      triggerActionTypes: TRIGGER_ACTION_TYPES,
    };
  }

  saveTrigger(profileKey: string, input: Record<string, unknown>, remove = false) {
    const id = String(input.id ?? '') || Math.random().toString(36).slice(2, 10);
    const trigger = remove ? undefined : newTrigger(id, input as Partial<Trigger>);
    const problem = trigger && triggerProblem(trigger);
    if (problem) throw new McpInputError(problem, { field: 'trigger' });
    this.writeSettings(profileKey, (draft) => {
      const others = (draft.triggers ?? []).filter((t: Trigger) => t.id !== id);
      const index = (draft.triggers ?? []).findIndex((t: Trigger) => t.id === id);
      if (trigger) others.splice(index < 0 ? others.length : index, 0, trigger);
      draft.triggers = others;
    });
    return remove ? { deleted: id } : trigger;
  }

  async saveChain(profileId: number, input: Record<string, unknown>, remove = false) {
    const profileKey = this.scriptHandler.getRuntime(profileId).profileKey;
    const id = String(input.id ?? '') || Math.random().toString(36).slice(2, 10);
    if (remove) {
      this.writeSettings(profileKey, (draft) => {
        delete draft.scripts?.chains?.[id];
        delete draft.scripts?.[id];
      });
      return { deleted: id };
    }
    const actions = new Set((await this.scriptHandler.getUiActions(profileId)).map((a) => a.pluginId));
    const steps = (input.steps as ChainStep[] | undefined) ?? [];
    if (!steps.length) throw new McpInputError('A chain needs at least one step.', { field: 'steps' });
    const stepIds = new Set(steps.map((step, index) => String(step.id ?? index + 1)));
    const validNext = (next?: string) =>
      !next || ['next', 'nextAlt', 'retryAlt', 'stop'].includes(next) ||
      (next.startsWith('step:') && stepIds.has(next.slice(5)));
    const chainSteps = steps.map((step, index) => {
      if (!actions.has(step.scriptId))
        throw new McpInputError(`Step ${index + 1} uses an unknown action: ${step.scriptId}`, {
          field: 'steps',
          correction: 'Use an action pluginId from get_plugin mode "actions".',
        });
      if (!validNext(step.onSuccess) || !validNext(step.onFail))
        throw new McpInputError(`Step ${index + 1} has an invalid onSuccess/onFail.`, { field: 'steps' });
      return { ...step, id: String(step.id ?? index + 1), name: step.name || step.scriptId };
    });
    const options = { gamemode: '', ...(input.options as object), name: String(input.name ?? 'Chain') };
    this.writeSettings(profileKey, (draft) => {
      draft.scripts ??= {};
      draft.scripts.chains = { ...draft.scripts.chains, [id]: { id, name: options.name, chains: chainSteps } };
      draft.scripts[id] = options;
    });
    return { id, pluginId: chainPluginId(id), steps: chainSteps, options };
  }

  private writeSettings(profileKey: string, update: (draft: any) => void) {
    const draft = structuredClone(this.scriptHandler.settings.getProfileSettings(profileKey));
    update(draft);
    this.scriptHandler.settings.replaceProfileSettings(profileKey, draft);
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
