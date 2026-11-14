/**
 * Chains: run a list of actions, in order, on every selected alt. Shared by
 * the desktop renderer, the worker runner and the mobile client.
 */

import { reminderDueAt, type Reminder } from './cooldowns';
import type { PluginOptionSchema } from './types/pluginOptions.d';

/** What a chain does after a step. `step:<id>` jumps to that step. */
export type ChainNext =
  | 'next'
  | 'nextAlt'
  | 'retryAlt'
  | 'stop'
  | `step:${string}`;

/** A single step in a chain — runs one action against the bot. */
export type ChainStep = {
  id: string;
  name: string;
  /** pluginId of the action to run. */
  scriptId: string;
  /** Option overrides for this step; unset options use the action's saved settings. */
  options?: Record<string, unknown>;
  /** Defaults to `next`. */
  onSuccess?: ChainNext;
  /** Defaults to `next`. A step fails when its action throws or returns `false`. */
  onFail?: ChainNext;
};

/**
 * A chain's run settings, stored flat at `settings.scripts[chainId]`. The alt
 * ids line up 1:1 with the shared alt-filter pipeline (`iterateAlts`).
 */
export type ChainOptions = {
  name: string;
  description?: string;
  gamemode: string;
  altRange?: [string | null, string | null];
  withTags?: string[];
  ignoreAlts?: string[];
  withRanks?: boolean;
  withGkits?: boolean;
};

export type Chain = {
  id: string;
  /** Ordered list of steps to run for each alt. */
  chains: ChainStep[];
  /**
   * JavaScript run for each alt before its steps, with `chain` (the chain
   * API), `bot` and `options` in scope — e.g. to set step options or patch a step.
   */
  setup?: string;
  /**
   * The chain's own options, defined like a plugin's `config`. Their values
   * are stored with the run settings and given to the setup code as `options`.
   */
  config?: PluginOptionSchema;
  /** Display name, mirrored from {@link ChainOptions.name} for the chain list. */
  name?: string;
  /** Legacy nested run settings; new chains store them in `settings.scripts[id]`. */
  options?: ChainOptions;
};

export const CHAIN_NEXT_CHOICES: { value: ChainNext; label: string }[] = [
  { value: 'next', label: 'Continue' },
  { value: 'nextAlt', label: 'Skip to the next alt' },
  { value: 'retryAlt', label: 'Relog and start over' },
  { value: 'stop', label: 'Stop the chain' },
];

/** Readable label for a step's outcome, e.g. "Go to step 3". */
export function chainNextLabel(next: ChainNext, steps: ChainStep[]): string {
  if (next.startsWith('step:')) {
    const index = steps.findIndex((step) => `step:${step.id}` === next);
    return index === -1 ? 'Continue' : `Go to step ${index + 1}`;
  }
  return CHAIN_NEXT_CHOICES.find((c) => c.value === next)?.label ?? 'Continue';
}

/** Chains run like plugins under this pluginId (cooldowns, schedules, `startPlugin`). */
const CHAIN_PLUGIN_PREFIX = 'chain:';
export const chainPluginId = (chainId: string) => CHAIN_PLUGIN_PREFIX + chainId;
export const chainIdFromPluginId = (pluginId?: string) =>
  pluginId?.startsWith(CHAIN_PLUGIN_PREFIX)
    ? pluginId.slice(CHAIN_PLUGIN_PREFIX.length)
    : undefined;

/**
 * When a chain is next worth running: the soonest cooldown among its steps'
 * actions (or the chain's own). Undefined when none of them has a cooldown.
 */
export function chainReadyAt(chain: Pick<Chain, 'id' | 'chains'>, reminders: readonly Reminder[]): number | undefined {
  const ids = new Set([chainPluginId(chain.id), ...chain.chains.map((step) => step.scriptId)]);
  const due = reminders
    .filter((reminder) => reminder.kind !== 'schedule' && ids.has(reminder.pluginId))
    .map(reminderDueAt);
  return due.length ? Math.min(...due) : undefined;
}

export const createChainStep = (): ChainStep => ({
  id: Math.random().toString(36).slice(2, 10),
  name: 'New action',
  scriptId: '',
});

/** Upgrade a saved step: ids used to be numbers and steps had a `delay`. */
export function normalizeChainStep(step: ChainStep & { delay?: unknown }): ChainStep {
  const { delay: _delay, ...rest } = step;
  return { ...rest, id: String(step.id) };
}

/** Fill `{key}` placeholders in text options with values from earlier steps. */
export function fillPlaceholders(
  options: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (!options) return {};
  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? value.replace(/\{(\w+)\}/g, (match, name) =>
            name in data ? String(data[name]) : match,
          )
        : value,
    ]),
  );
}

/**
 * Starter setup code for a chain, using its own step names so it reads as an
 * example of this chain. Every line is a comment, so it changes nothing.
 */
export function defaultChainSetup(chain: Pick<Chain, 'chains'>): string {
  const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const [first, second] = [chain.chains[0]?.name ?? 'Step name', chain.chains[1]?.name ?? 'Another step'].map(quote);
  return `// Setup code: runs for every alt before the steps.
// \`chain\` controls this chain and \`bot\` is the alt's bot. Steps are found by name.
// Remove the // in front of a line to use it.
// Docs: https://jnbot.netlify.app/docs/plugins/code-based/script#chains
// \`options\` holds the values of this chain's own options (gear button above).

// Always run a step with some options, whatever the step's own settings say.
// Use the option ids of the step's plugin:
// chain.setOptions(${first}, { optionId: 'value' });

// Skip a step, or only run it from here with chain.runStep:
// chain.disableStep(${second});

// Change how a step works by name of its task (see the plugin's code), e.g. run
// another step whenever its inventory is full, then let it carry on:
// chain.patch(${first}, (machine) => {
//   machine.wrapTask('Task name', async (ctx, run) => {
//     if (ctx.bot.inventory.emptySlotCount() < 8) await chain.runStep(${second});
//     await run(ctx);
//   });
// });
`;
}

/** Setup code worth storing: none when it is empty or still the starter code. */
export const chainSetupToSave = (chain: Pick<Chain, 'chains'>, code: string): string | undefined =>
  code.trim() && code.trim() !== defaultChainSetup(chain).trim() ? code : undefined;

