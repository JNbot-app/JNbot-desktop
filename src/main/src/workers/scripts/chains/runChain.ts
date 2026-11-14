import type { Chain, ChainNext } from '../../../../../common/chains';
import type { Bot } from '../../workerTypes';
import workerScript from '../../lib/workerScript';
import { iterateBots, IterateDirective } from '../iterateAlts';
import ChainRun from './ChainRun';

/** What the alt loop does once an alt's steps are over. */
type AltResult = IterateDirective | 'stop' | undefined;

const NEXT_DIRECTIVE: Partial<Record<ChainNext, AltResult>> = {
  nextAlt: 'next',
  retryAlt: 'retry',
  stop: 'stop',
};

/** Guards against "go to step" loops that never end. */
const MAX_STEP_RUNS = 500;

/**
 * Run the chain's steps against the joined bot, following each step's
 * "if it works / if it fails" outcome, after the chain's setup code. Disabled
 * steps are skipped. Returns undefined to defer to the control buttons if the
 * bot dropped out.
 */
async function runSteps(bot: Bot, chain: Chain): Promise<AltResult> {
  const run = new ChainRun(chain, bot);
  // Broken setup code would fail on every alt, so stop instead.
  if (!(await run.setup())) return 'stop';
  let index = 0;
  for (let runs = 0; index < run.steps.length; runs++) {
    if (runs >= MAX_STEP_RUNS) {
      global.log('Chain kept repeating steps — moving to the next alt', 'warning');
      return 'next';
    }
    if (!bot.isOnline?.()) return undefined;

    const step = run.steps[index];
    if (!run.isEnabled(step)) {
      index++;
      continue;
    }
    const { ok, directive } = await run.run(step);
    // Where the chain API said to go wins, then a code the action returned.
    const chosen = run.next;
    run.next = undefined;
    if (!chosen && directive) return directive;

    const next = chosen ?? (ok ? step.onSuccess : step.onFail) ?? 'next';
    if (next in NEXT_DIRECTIVE) return NEXT_DIRECTIVE[next];
    const target = run.steps.findIndex((s) => `step:${s.id}` === next);
    // Steps may have been added before this one, so look it up again.
    index = target === -1 ? run.steps.indexOf(step) + 1 : target;
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
    const directive = await runSteps(result.value, chain);
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
