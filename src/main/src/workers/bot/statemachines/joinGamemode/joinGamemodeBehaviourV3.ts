import workerScript from 'main/src/workers/lib/workerScript';
import {
  applyCommandTemplate,
  DEFAULT_COMMAND_TEMPLATE,
  getJoinBehaviour,
  type GamemodeJoinBehaviour,
} from 'common/joinBehaviour';
import { gamemodeKey } from 'common/profiles';
import { Bot } from 'main/src/workers/workerTypes';
import {
  confirmGamemode,
  detectedGamemode,
  gamemodeMatches,
  getJoinHandler,
} from '../../gamemode';
import type { JoinHandler, Task } from 'common/types/pluginApi';
import BotMachine from '../BotMachine';
import { BotEvents } from 'common/types/botApi';

/**
 * Generic gamemode-join behaviour. Reads the per-gamemode rule from the active
 * profile (`data.joinBehaviours[gamemodeKey]`) and dispatches accordingly:
 *
 *   - `direct`   — no action needed, just verify the join.
 *   - `command`  — send a chat command built from the user's template.
 *   - `selector` — equip the configured hotbar slot, right-click it to open
 *                  the menu, then click the gamemode item (by name) or a
 *                  static slot.
 *   - `auto`     — alternate between command and selector until one sticks.
 *   - `action`   — run the profile's join action instead (see `profileJoinAction`).
 *
 * Successful entry is judged from several signals so no single source needs
 * to be perfectly reliable:
 *   - `forcedMove` / `respawn` events (server-side teleport).
 *   - A scoreboard/`getGamemode()` value that matches the target.
 *   - A large `move` delta after a join attempt.
 *   - "You are in position N of M" messages → bot is queued, we wait.
 *
 * The flow runs as prioritised {@link BotMachine} tasks (`{ when, run }`, the
 * first match each tick runs). A handler set with `bot.setJoinHandler` replaces
 * the whole flow for servers these defaults do not fit.
 */

/** Per-attempt bookkeeping shared across ticks. */
interface JoinData {
  behaviour: GamemodeJoinBehaviour;
  targetKey: string;
  in_queue: boolean;
  cmdSent: boolean;
  autoToggle: number;
  attempts: number;
  lastActionAt: number;
}

/** Listeners we attach to the bot and must tear down again on finish. */
interface JoinEvents {
  messagestr?: (msg: string) => void;
  move?: () => void;
  forcedMove?: () => void;
  respawn?: () => void;
}

/** The shared, mutable scratch space the join steps read and write. */
export interface JoinTargets {
  joinOptions: {
    gamemode: string;
    optimisticJoin?: boolean;
  };
  __join_events?: JoinEvents;
  __join_timeouts?: Record<string, NodeJS.Timeout>;
  __join_data?: JoinData;
  __join_stuck_counter?: number;
  /** Set once the bot has reached the gamemode; makes every step go quiet. */
  __join_done?: boolean;
  /** Set when joining stops with an actionable failure. */
  __join_error?: string;
}

const SELECTOR_WINDOW_HINTS = ['server', 'selector', 'compass', 'navigator', 'play'];
const QUEUE_POSITION_RE = /position\s+([0-9]+)\s+of\s+([0-9]+)/i;
const QUEUE_REFRESH_MS = 20_000;
const MAX_STUCK = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForBotEvent(
  bot: Bot,
  events: (keyof BotEvents)[],
  options: { timeoutMs: number; fallback?: Promise<unknown> },
): Promise<void> {  
  return new Promise((resolve) => {
    let settled = false;
    const watchedEvents = [...new Set<keyof BotEvents>([...events, 'end', 'kicked'])];
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      watchedEvents.forEach((event) => bot.removeListener(event, finish));
      resolve();
    };
    const timeout = setTimeout(finish, options.timeoutMs);

    watchedEvents.forEach((event) => bot.on(event, finish));
    void options.fallback?.then(finish, finish);
  });
}

function looksLikeSelector(title: string): boolean {
  const t = (title || '').toLowerCase();
  return SELECTOR_WINDOW_HINTS.some((h) => t.includes(h));
}

/** The built-in join steps, run by a `BotMachine` until one finishes it. */
function buildJoinTasks(): Task<JoinTargets>[] {
  const tasks: Task<JoinTargets>[] = [
    {
      name: 'Direct join — nothing to do',
      when: ({ state }) => state.__join_data?.behaviour.kind === 'direct',
      run: ({ bot, state, machine }) => {
        confirmGamemode(bot, state.__join_data!.targetKey);
        machine.finish();
      },
    },
    {
      name: 'Bot is offline',
      when: ({ bot }) => !bot || !bot.isOnline?.(),
      run: ({ machine }) => {
        machine.finish();
      },
    },
    {
      // Idempotent: re-runs whenever the listeners have been torn down (fresh
      // bot, or after a stuck bailout), so no `once`/re-arm bookkeeping needed.
      name: 'Setting up listeners',
      when: ({ state }) => !state.__join_events,
      run: ({ bot, state, machine }) => {
        const profile = workerScript.getProfile();
        const behaviour = getJoinBehaviour(
          profile?.data,
          state.joinOptions.gamemode,
        );
        const targetKey = gamemodeKey(state.joinOptions.gamemode);

        state.__join_events ??= {};
        state.__join_timeouts ??= {};
        state.__join_data = {
          behaviour,
          targetKey,
          in_queue: false,
          cmdSent: false,
          autoToggle: 0,
          attempts: 0,
          lastActionAt: 0,
        };

        if (state.joinOptions.optimisticJoin === undefined) {
          state.joinOptions.optimisticJoin =
            (global.appSettings?.optimistic_join_gamemode as
              | boolean
              | undefined) ?? false;
        }

        // Real teleports / respawns are strong signals that we landed somewhere.
        const markFinished = () => {
          if (!state.__join_data) return;
          state.__join_data.in_queue = false;
          const detected = detectedGamemode(bot);
          if (
            state.joinOptions.optimisticJoin ||
            gamemodeMatches(detected, state.__join_data.targetKey) ||
            // Without a detector, a teleport after our join attempt is the only signal.
            (!detected && state.__join_data.attempts > 0)
          ) {
            confirmGamemode(bot, state.__join_data.targetKey);
            machine.finish();
          }
        };

        state.__join_events.forcedMove = markFinished;
        state.__join_events.respawn = markFinished;
        state.__join_events.move = () => {
          if (!bot.entity) return;
          const prev = bot.entity.position.minus(bot.entity.velocity);
          if (prev.distanceTo(bot.entity.position) < 1) return; // ignore micro-stutter
          markFinished();
        };

        state.__join_events.messagestr = (msg: string) => {
          const m = String(msg ?? '').trim();
          if (!m || !state.__join_data) return;

          const queueMatch = QUEUE_POSITION_RE.exec(m);
          if (queueMatch && state.__join_data.cmdSent) {
            global.log(
              `[State] ${bot.username} is in ${state.joinOptions.gamemode} queue: ${queueMatch[1]}/${queueMatch[2]}`,
            );
            state.__join_data.in_queue = true;
            clearTimeout(state.__join_timeouts!.queue);
            state.__join_timeouts!.queue = setTimeout(() => {
              if (state.__join_data) state.__join_data.in_queue = false;
            }, QUEUE_REFRESH_MS);
            return;
          }

          if (
            state.__join_data.in_queue &&
            m.includes('Please reconnect to the server')
          ) {
            state.__join_data.in_queue = false;
            clearTimeout(state.__join_timeouts!.queue);
          }
        };

        bot.on('messagestr', state.__join_events.messagestr);
        bot.on('move', state.__join_events.move);
        bot.on('forcedMove', state.__join_events.forcedMove);
        bot.on('respawn', state.__join_events.respawn);
      },
    },
    {
      name: 'Joined gamemode!',
      when: ({ bot, state }) =>
        gamemodeMatches(bot.getGamemode(), state.__join_data?.targetKey ?? ''),
      run: ({ bot, state, machine }) => {
        confirmGamemode(bot, state.__join_data!.targetKey);
        machine.finish();
      },
    },
    {
      name: 'Waiting for queue to end',
      when: ({ state }) => !!state.__join_data?.in_queue,
      run: ({ state }) => {
        state.__join_stuck_counter = 0;
      },
    },

    {
      name: 'Bailing out (stuck)',
      when: ({ state }) => (state.__join_stuck_counter ?? 0) > MAX_STUCK,
      run: ({ bot, state, machine }) => {
        state.__join_error = `${bot.username} could not reach ${state.joinOptions.gamemode}.`;
        global.log(state.__join_error, 'error');
        machine.finish();
      },
    },

    {
      name: 'Closing unrelated window',
      when: ({ bot }) =>
        !!bot?.currentWindow &&
        !looksLikeSelector(bot.getWindowTitle?.() ?? ''),
      run: async ({ bot }) => {
        global.log('Closing unexpected open window:' + bot.getWindowTitle?.());
        if (bot.currentWindow) bot.closeWindow?.(bot.currentWindow);
        await bot.waitForTicks?.(5);
      },
    },

    {
      name: 'Opening selector / sending command',
      when: ({ bot, state }) =>
        !bot?.currentWindow && !state.__join_data?.in_queue,
      run: async ({ bot, state }) => {
        const data = state.__join_data!;
        data.attempts++;
        data.lastActionAt = Date.now();
        state.__join_stuck_counter = (state.__join_stuck_counter ?? 0) + 1;

        const kind = data.behaviour.kind;
        const useCommand =
          kind === 'command' || (kind === 'auto' && data.autoToggle % 2 === 0);
        const useSelector =
          kind === 'selector' || (kind === 'auto' && data.autoToggle % 2 === 1);
        data.autoToggle++;

        if (useCommand) {
          await runCommand(bot, state, data.behaviour);
        } else if (useSelector) {
          await openSelector(bot, state, data.behaviour);
          if (bot.currentWindow) return;
        }

        // After acting we wait for either a window to open, a forced move,
        // or a short timeout — whichever comes first.

        const isFirstTryWithAuto =
          data.attempts === 1 && data.behaviour.kind === 'auto';

        await waitForBotEvent(
          bot,
          ['windowOpen', 'forcedMove', 'respawn'],
          {
            timeoutMs: 4000,
            fallback:
              bot.waitForTicks?.(isFirstTryWithAuto ? 20 : 60) ??
              sleep(isFirstTryWithAuto ? 1000 : 3000),
          },
        );
      },
    },

    {
      name: 'Clicking gamemode in selector',
      when: ({ bot }) => !!bot?.currentWindow,
      run: async ({ bot, state, machine }) => {
        const data = state.__join_data!;
        state.__join_stuck_counter = 0;

        const slot = pickSelectorSlot(bot, data.behaviour, data.targetKey);
        if (slot === undefined || slot === null) {
          global.log(
            `[State] ${bot.username} could not locate ${state.joinOptions.gamemode} inside the selector — closing and retrying.`,
            'warning',
          );
          if (bot.currentWindow) bot.closeWindow?.(bot.currentWindow);
          await bot.waitForTicks?.(5);
          return;
        }

        bot.clickWindow?.(slot, 0, 0);
        await bot.waitForTicks?.(10);

        if (state.joinOptions.optimisticJoin) {
          await sleep(800);
          confirmGamemode(bot, data.targetKey);
          machine.finish();
        }
      },
    },
  ];

  return tasks;
}

/** Tear down everything the join steps attached to the bot/state. */
function runJoinCleanup(bot: Bot | null, state: JoinTargets): void {
  if (state.__join_data) {
    state.__join_data.in_queue = false;
    state.__join_data.cmdSent = false;
  }
  state.__join_stuck_counter = 0;

  const events = state.__join_events;
  if (events && bot) {
    for (const [event, fn] of Object.entries(events)) {
      if (fn) bot.removeListener(event as keyof typeof events, fn);
    }
  }
  state.__join_events = undefined;

  const timeouts = state.__join_timeouts;
  if (timeouts) {
    for (const handle of Object.values(timeouts)) clearTimeout(handle);
  }
  state.__join_timeouts = undefined;
  console.log(
    `Finished joining ${state.joinOptions.gamemode} after ${state.__join_data?.attempts ?? 0} attempt.`,
  );
}

/**
 * Enter `gamemode`: through the bot's custom join handler when one is set,
 * otherwise through the built-in flow. Rejects when the bot cannot get there.
 */
function joinGamemode(
  bot: Bot,
  gamemode: string,
  options: { optimisticJoin?: boolean } = {},
): Promise<void> {
  const handler = getJoinHandler(bot) ?? profileJoinAction(gamemode);
  if (handler) return runJoinHandler(bot, gamemode, handler);

  return new Promise((resolve, reject) => {
    new BotMachine(buildJoinTasks(), {
      bot,
      state: { joinOptions: { gamemode, ...options } },
      // No user tasks follow, so stop & resolve once the join steps go quiet.
      stopWhenIdle: true,
      disableAutoReconnect: true,
    })
      .onFinish(({ bot, state }) => {
        runJoinCleanup(bot, state);
        if (state.__join_error) reject(new Error(state.__join_error));
        else resolve();
      })
      .start();
  });
}

/** The profile's join action for `gamemode`, when its join method is `action`. */
function profileJoinAction(gamemode: string): JoinHandler | undefined {
  const behaviour = getJoinBehaviour(workerScript.getProfile()?.data, gamemode);
  if (behaviour.kind !== 'action') return undefined;
  const action = workerScript.workerData.joinActions?.[gamemodeKey(gamemode)];
  return (target, bot) => {
    if (!action) throw new Error(`The join action for ${target} could not be loaded.`);
    // Lazy require: the runner loads after join.js to avoid an import cycle.
    const { runProfileAction } = require('../../extensions/botExtension');
    return runProfileAction(action, bot, [target]);
  };
}

/**
 * Run a user join handler. Returning `false` or throwing fails the join, as
 * does a detector that reports another gamemode afterwards.
 */
async function runJoinHandler(
  bot: Bot,
  gamemode: string,
  handler: JoinHandler,
): Promise<void> {
  const joined = await handler(gamemode, bot);
  const detected = detectedGamemode(bot);
  if (joined === false || (detected && !gamemodeMatches(detected, gamemode))) {
    throw new Error(`${bot.username} could not reach ${gamemode}.`);
  }
  confirmGamemode(bot, gamemode);
}

async function runCommand(
  bot: Bot,
  state: JoinTargets,
  behaviour: GamemodeJoinBehaviour,
) {
  const template =
    behaviour.kind === 'command' && behaviour.command
      ? behaviour.command
      : DEFAULT_COMMAND_TEMPLATE;

  const cmd = applyCommandTemplate(template, state.joinOptions.gamemode);
  if (!cmd) return;
  bot.chat?.('/queue leave'); // bail out of any prior queue first
  await sleep(150);
  bot.chat?.(cmd);
  if (state.__join_data) state.__join_data.cmdSent = true;
}

async function openSelector(
  bot: Bot,
  state: JoinTargets,
  behaviour: GamemodeJoinBehaviour,
) {
  bot.chat('/server');

  // Default to the last hotbar slot if no selector config exists yet (auto mode).
  const slot = behaviour.kind === 'selector' ? behaviour.hotbarSlot : 9;

  const quickBarSlot = Math.max(0, Math.min(8, (slot ?? 9) - 1));
  if (bot.quickBarSlot !== quickBarSlot ) {
    await bot.setQuickBarSlot?.(quickBarSlot);
  }
  await sleep(50);
  if(bot.currentWindow) return
  bot.activateItem?.();
  if (state.__join_data) state.__join_data.cmdSent = false;
}

function pickSelectorSlot(
  bot: Bot,
  behaviour: GamemodeJoinBehaviour,
  targetKey: string,
): number | undefined {
  const win = bot.currentWindow;
  if (!win) return undefined;

  // Static slot wins outright when the user opted into it.
  if (behaviour.kind === 'selector' && behaviour.pick === 'slot') {
    const idx = behaviour.staticSlot;
    if (typeof idx === 'number' && idx >= 0 && idx < win.inventoryStart) {
      return idx;
    }
  }

  // Otherwise scan the chest portion of the window for an item whose name
  // includes the target gamemode key.
  for (let i = 0; i < win.inventoryStart; i++) {
    const item = win.slots[i];
    if (!item) continue;
    const info = bot.itemInfo?.(item);
    const name = info?.name?.toLowerCase?.().replace(/(§.|[^a-z])/g, '');

    if (!name) continue;
    if (name.includes(targetKey)) return item.slot;
  }

  // Last-resort fallback for `auto`: use the configured static slot if any.
  if (
    behaviour.kind === 'selector' &&
    typeof behaviour.staticSlot === 'number'
  ) {
    return behaviour.staticSlot;
  }

  return undefined;
}

export default joinGamemode;
