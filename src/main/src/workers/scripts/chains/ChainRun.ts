import type { Chain, ChainNext, ChainStep } from '../../../../../common/chains';
import { chainPluginId, createChainStep, fillPlaceholders } from '../../../../../common/chains';
import type { ChainAPI, ChainStepInfo } from '../../../../../common/types/pluginApi';
import type { MachinePatch } from '../../bot/statemachines/BotMachine';
import type { Bot } from '../../workerTypes';
import type { MacroInfo } from '../../../types';
import { runJS } from '../../compiler/jsRuntime';
import { resolvePluginOptions } from '../../bot/plugin/resolvePluginOptions';
import type { IterateDirective } from '../iterateAlts';
import scriptActionRunner = require('../../compiler/scriptActions');

/**
 * Codes an action can return to steer the chain (0 = success → next step):
 *   1 NEXT ALT  — skip to the next alt,
 *   2 RELOG     — rejoin and restart the chain on this alt,
 *   3 PREV ALT  — go back to the previous alt.
 */
const STATUS_DIRECTIVE: Record<number, IterateDirective> = {
  1: 'next',
  2: 'retry',
  3: 'previous',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export type StepResult = { ok: boolean; directive?: IterateDirective };

/**
 * One alt's pass through a chain. It runs the steps and backs the `chain` API
 * that those steps get, so changes made through that API (patches, disabled
 * or added steps) last until the chain moves on to the next alt.
 */
export default class ChainRun {
  readonly steps: ChainStep[];
  /** Values returned by earlier steps, filled into `{key}` placeholders. */
  readonly data: Record<string, unknown>;
  readonly api: ChainAPI;
  /** Where to go after the current step, set through the API. */
  next?: ChainNext;

  private readonly disabled = new Set<string>();
  private readonly patches = new Map<string, MachinePatch[]>();
  /** Options set with `chain.setOptions`, on top of each step's overrides. */
  private readonly options = new Map<string, Record<string, unknown>>();
  /** Steps running right now; a step can run another one. */
  private readonly running: ChainStep[] = [];

  constructor(private readonly chain: Chain, readonly bot: Bot) {
    this.steps = [...chain.chains];
    this.data = { alt: bot.username };
    this.api = this.createApi(chain);
  }

  /**
   * Run the chain's setup code, if any, before the steps. It gets `chain`,
   * `bot` and the values of the chain's own options (also `script.settings`),
   * resolved like a plugin's. Resolves false when it throws.
   */
  async setup(): Promise<boolean> {
    if (!this.chain.setup?.trim()) return true;
    // The saved values arrive as the chain's run settings.
    const options = resolvePluginOptions(
      { pluginId: this.chain.id, name: this.api.name, config: this.chain.config } as MacroInfo,
      this.chain.options,
    );
    const scriptInfo = {
      pluginId: chainPluginId(this.chain.id),
      name: `${this.api.name} setup`,
      language: 'js',
      scriptType: 'action',
    } as MacroInfo;
    try {
      await runJS({
        // On one line, so line numbers in errors match the editor.
        code: `async function main(chain, bot, options) { ${this.chain.setup}\n}`,
        scriptInfo,
        scriptOptions: options,
        args: [this.api, this.bot, options],
        runAsAction: true,
        context: { chain: this.api },
      });
      return true;
    } catch (err) {
      global.log(`The chain's setup code failed: ${err}`, 'error');
      return false;
    }
  }

  isEnabled(step: ChainStep): boolean {
    return !this.disabled.has(step.id);
  }

  /**
   * Run a step with its option overrides, then those from `chain.setOptions`,
   * then `options` on top. Its action
   * gets the values of earlier steps as `args[0]`; returning an object adds
   * values for the steps after it.
   */
  async run(step: ChainStep, options?: Record<string, unknown>): Promise<StepResult> {
    this.running.push(step);
    try {
      const result = await scriptActionRunner({
        id: step.scriptId,
        bot: this.bot,
        args: [this.data],
        optionOverrides: {
          ...fillPlaceholders(step.options, this.data),
          ...fillPlaceholders(this.options.get(step.id), this.data),
          ...fillPlaceholders(options, this.data),
        },
        context: { chain: this.api, patches: this.patchesOf(step) },
      });
      if (isRecord(result)) Object.assign(this.data, result);
      return { ok: result !== false, directive: STATUS_DIRECTIVE[result as number] };
    } catch (err) {
      global.log(`Step "${step.name}" failed: ${err}`, 'error');
      return { ok: false };
    } finally {
      this.running.pop();
    }
  }

  /** A step by id, plugin id (the first such step) or name. */
  find(ref: string): ChainStep {
    const step =
      this.steps.find((s) => s.id === ref) ??
      this.steps.find((s) => s.scriptId === ref) ??
      this.steps.find((s) => s.name === ref);
    if (!step) throw new Error(`The chain has no step "${ref}"`);
    return step;
  }

  private patchesOf(step: ChainStep): MachinePatch[] {
    let patches = this.patches.get(step.id);
    if (!patches) this.patches.set(step.id, (patches = []));
    return patches;
  }

  private info = (step: ChainStep): ChainStepInfo => ({
    ...step,
    options: { ...step.options, ...this.options.get(step.id) },
    enabled: this.isEnabled(step),
  });

  private createApi(chain: Chain): ChainAPI {
    const run = this;
    return {
      id: chain.id,
      name: chain.options?.name ?? chain.name ?? 'chain',
      bot: this.bot,
      data: this.data,
      get steps() {
        return run.steps.map(run.info);
      },
      get current() {
        const step = run.running[run.running.length - 1];
        return step ? run.info(step) : null;
      },
      runStep: async (ref, options) => (await run.run(run.find(ref), options)).ok,
      patch: (ref, patch) => {
        run.patchesOf(run.find(ref)).push(patch);
      },
      setOptions: (ref, options) => {
        const { id } = run.find(ref);
        run.options.set(id, { ...run.options.get(id), ...options });
      },
      enableStep: (ref) => {
        run.disabled.delete(run.find(ref).id);
      },
      disableStep: (ref) => {
        run.disabled.add(run.find(ref).id);
      },
      addStep: ({ name, scriptId, options }, after) => {
        const step: ChainStep = { ...createChainStep(), name: name ?? scriptId, scriptId, options };
        const index = after === undefined ? run.steps.length : run.steps.indexOf(run.find(after)) + 1;
        run.steps.splice(index, 0, step);
        return run.info(step);
      },
      goTo: (ref) => {
        run.next = `step:${run.find(ref).id}`;
      },
      skipAlt: () => {
        run.next = 'nextAlt';
      },
      stop: () => {
        run.next = 'stop';
      },
    };
  }
}
