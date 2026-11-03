import type { Chain, ChainNext, ChainStep } from '../../../../../common/chains';
import { fillPlaceholders } from '../../../../../common/chains';
import type { Bot } from '../../workerTypes';
import workerScript from '../../lib/workerScript';
import { iterateBots, IterateDirective } from '../iterateAlts';
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

/** What the alt loop does once an alt's steps are over. */
type AltResult = IterateDirective | 'stop' | undefined;

const NEXT_DIRECTIVE: Partial<Record<ChainNext, AltResult>> = {
  nextAlt: 'next',
  retryAlt: 'retry',
  stop: 'stop',
};

/** Guards against "go to step" loops that never end. */
const MAX_STEP_RUNS = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Run one step. Its action gets the values of earlier steps as `args[0]`, and
 * `{key}` placeholders in its option overrides are filled from them; returning
 * an object adds values for the steps after it.
 */
async function runStep(
  bot: Bot,
  step: ChainStep,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; directive?: IterateDirective }> {
  try {
    const result = await scriptActionRunner({
      id: step.scriptId,
      bot,
      args: [data],
      optionOverrides: fillPlaceholders(step.options, data),
    });
    if (isRecord(result)) Object.assign(data, result);
    return { ok: result !== false, directive: STATUS_DIRECTIVE[result as number] };
  } catch (err) {
    global.log(`Step "${step.name}" failed: ${err}`, 'error');
    return { ok: false };
  }
}

/**
 * Run the chain's steps against the joined bot, following each step's
 * "if it works / if it fails" outcome. An explicit code from an action wins;
 * returns undefined to defer to the control buttons if the bot dropped out.
 */
async function runSteps(bot: Bot, steps: ChainStep[]): Promise<AltResult> {
  const data: Record<string, unknown> = { alt: bot.username };
  let index = 0;
  for (let runs = 0; index < steps.length; runs++) {
    if (runs >= MAX_STEP_RUNS) {
      global.log('Chain kept repeating steps — moving to the next alt', 'warning');
      return 'next';
    }
    if (!bot.isOnline?.()) return undefined;

    const step = steps[index];
    const { ok, directive } = await runStep(bot, step, data);
    if (directive) return directive;

    const next = (ok ? step.onSuccess : step.onFail) ?? 'next';
    if (next in NEXT_DIRECTIVE) return NEXT_DIRECTIVE[next];
    const target = steps.findIndex((s) => `step:${s.id}` === next);
    index = target === -1 ? index + 1 : target;
  }
  return 'next';
}

/**
 * Runs a chain — like `defaultActionRunner`, but executes N actions per alt
 * instead of one. Alt filtering, joining, the control buttons and per-alt
 * cleanup are delegated to `iterateBots`; we drive it by hand so a step can
 * advance, step back, relog or stop.
 */
async function runChain(chain: Chain) {
  if (!chain?.chains?.length) {
    global.log('No chain to run', 'warning');
    return workerScript.stop();
  }

  const alts = workerScript.getAlts({ fullAlts: false });
  const options = chain.options ?? ({} as NonNullable<Chain['options']>);
  const name = options.name ?? chain.name ?? 'chain';

  const iterator = iterateBots(alts, options, {
    join: { gamemode: options.gamemode, login: true },
    showProgress: true,
  });

  let result = await iterator.next();
  while (!result.done) {
    const directive = await runSteps(result.value, chain.chains);
    if (directive === 'stop') {
      await iterator.return();
      break;
    }
    result = await iterator.next(directive);
  }

  global.log(`Finished running ${name}`, 'success');
  workerScript.stop();
}

export default runChain;
