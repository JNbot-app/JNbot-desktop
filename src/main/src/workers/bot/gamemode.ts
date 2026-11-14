import type { Bot } from 'main/src/workers/workerTypes';
import type { GamemodeDetector, JoinHandler } from 'common/types/pluginApi';
import { gamemodeKey } from 'common/profiles';

/**
 * Per-server gamemode hooks. Servers differ in how a gamemode is entered and
 * how the current one is shown, so both are pluggable per bot (typically from
 * the profile's on-join action):
 *
 *   - `bot.setJoinHandler(fn)`       replaces how `bot.join` enters a gamemode.
 *   - `bot.setGamemodeDetector(fn)`  tells `bot.getGamemode()` where we are.
 *
 * Without a detector, `getGamemode()` falls back to the last gamemode a join
 * confirmed. Old bot references follow their session to the live bot.
 */

interface GamemodeState {
  detector?: GamemodeDetector;
  joinHandler?: JoinHandler;
  confirmed: string | null;
  detecting: boolean;
}

const states = new WeakMap<Bot, GamemodeState>();

function stateOf(bot: Bot): GamemodeState {
  let state = states.get(bot);
  if (!state) {
    state = { confirmed: null, detecting: false };
    states.set(bot, state);
  }
  return state;
}

/** The connected bot: a stale reference resolves to its session's live bot. */
export function liveBot(bot: Bot): Bot {
  const sessionBot = bot.session?.bot;
  return sessionBot && sessionBot !== bot ? sessionBot : bot;
}

export function gamemodeMatches(
  actual: string | null | undefined,
  targetKey: string,
): boolean {
  if (!actual) return false;
  return gamemodeKey(actual).includes(gamemodeKey(targetKey));
}

/** What the detector reports, or null when there is none or it has no answer. */
export function detectedGamemode(bot: Bot): string | null {
  const state = stateOf(bot);
  // A detector that calls bot.getGamemode() itself sees the confirmed value.
  if (!state.detector || state.detecting) return null;
  state.detecting = true;
  try {
    const value = state.detector(bot);
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return null;
  } finally {
    state.detecting = false;
  }
}

export function confirmGamemode(bot: Bot, gamemode: string): void {
  stateOf(bot).confirmed = gamemodeKey(gamemode);
}

export function getJoinHandler(bot: Bot): JoinHandler | undefined {
  return stateOf(bot).joinHandler;
}

export function installGamemodeApi(bot: Bot): void {
  const getGamemode = () => {
    const live = liveBot(bot);
    return detectedGamemode(live) ?? stateOf(live).confirmed;
  };

  bot.setGamemodeDetector = (detector) => {
    stateOf(liveBot(bot)).detector = detector ?? undefined;
  };
  bot.setJoinHandler = (handler) => {
    stateOf(liveBot(bot)).joinHandler = handler ?? undefined;
  };

  // Assigning `bot.getGamemode = fn` (older profiles) installs a detector
  // instead of replacing the getter, so join confirmation keeps working.
  Object.defineProperty(bot, 'getGamemode', {
    configurable: true,
    enumerable: true,
    get: () => getGamemode,
    set: (detector: GamemodeDetector) => bot.setGamemodeDetector(detector),
  });
}
