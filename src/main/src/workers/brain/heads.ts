/**
 * Built-in heads: the player's controls, labelled from JNbot Client input and
 * applied to a mineflayer bot. Custom heads implement the same {@link BrainHead}.
 */
import { Vec3 } from 'vec3';

import type { Bot } from '../workerTypes';
import type {
  BrainDecision,
  BrainHead,
  BrainHeadName,
  BrainHoldCategory,
} from '../../../../common/types/brainApi';
import { type ActCommand, BLOCK_REACH, FACES, UNATTACKABLE } from './actions';
import { resolveTarget } from './navigate';
import { wrapAngle } from './observation';

/** items used from the main hand on right click; anything else falls through to the off hand (shield) */
const MAIN_HAND_USE = /bow|trident|potion|milk_bucket|shield/;
const usableInMainHand = (bot: Bot, name = '') =>
  MAIN_HAND_USE.test(name) || !!bot.registry.foodsByName[name];

/** -1/0/1 axis stored as 3 classes */
function axis(
  name: string,
  label: 'forward' | 'strafe',
  positive: 'forward' | 'right',
  negative: 'back' | 'left',
): BrainHead {
  return {
    name,
    type: 'class',
    classes: 3,
    move: true,
    label: (input) => input[label] + 1,
    apply: (bot, value) => {
      bot.setControlState(positive, value === 2);
      bot.setControlState(negative, value === 0);
    },
  };
}

function toggle(name: 'jump' | 'sprint' | 'sneak'): BrainHead {
  return {
    name,
    type: 'binary',
    move: true,
    label: (input) => +input[name],
    apply: (bot, value) => bot.setControlState(name, value > 0),
  };
}

/** min ms between hits: about a sword's cooldown, so the bot doesn't spam weak hits */
const ATTACK_COOLDOWN_MS = 600;
const lastAttack = new WeakMap<object, number>();
/** min ms between right clicks on a block */
const USE_BLOCK_COOLDOWN_MS = 250;
const lastUseBlock = new WeakMap<object, number>();

/** the target block when it is within reach */
function blockInReach(bot: Bot, decision: BrainDecision) {
  const target = resolveTarget(bot, decision.target);
  if (!target?.block) return null;
  const eye = bot.entity.position.offset(0, bot.entity.height * 0.9, 0);
  return eye.distanceTo(target.position) <= BLOCK_REACH ? target.block : null;
}

function useHeldItem(bot: Bot) {
  if (usableInMainHand(bot, bot.heldItem?.name)) bot.activateItem();
  else if (usableInMainHand(bot, bot.inventory.slots[45]?.name))
    bot.activateItem(true);
}

export const BUILTIN_HEADS: Record<BrainHeadName, BrainHead> = {
  forward: axis('forward', 'forward', 'forward', 'back'),
  strafe: axis('strafe', 'strafe', 'right', 'left'),
  jump: toggle('jump'),
  sprint: toggle('sprint'),
  sneak: toggle('sneak'),
  attack: {
    name: 'attack',
    type: 'binary',
    label: (input) => +(input.attack !== null),
    apply: (bot, value, decision) => {
      if (!value) return;
      if (decision.target?.kind === 'block') {
        const block = blockInReach(bot, decision);
        if (block && !bot.targetDigBlock)
          bot.dig(block, true).catch(() => undefined);
        return;
      }
      if (Date.now() - (lastAttack.get(bot) ?? 0) < ATTACK_COOLDOWN_MS) return;
      const target =
        (decision.target && bot.entities[decision.target.id]) ||
        bot.entityAtCursor(3.5);
      if (
        target &&
        target !== bot.entity &&
        !UNATTACKABLE.has(target.name ?? '') &&
        target.position.distanceTo(bot.entity.position) <= 3.5
      ) {
        lastAttack.set(bot, Date.now());
        bot.attack(target);
      }
    },
  },
  // right click: on a target block (plant seeds, open a chest), else held to
  // eat, charge a bow (release shoots), raise an off-hand shield
  use: {
    name: 'use',
    type: 'binary',
    // what actually happened, so a blocked eat or empty bow isn't learned as "using"
    label: (input, _o, next) => +(next.self.usingItem || input.useOn !== null),
    // starting is rare per step, so sample it like the player; once using,
    // take the likely option so the bow isn't released or eating stopped at random
    sample: (o) => !o.self.usingItem,
    apply: (bot, value, decision) => {
      if (!value) {
        if (bot.usingHeldItem) bot.deactivateItem();
        return;
      }
      if (bot.usingHeldItem) return;
      const block = blockInReach(bot, decision);
      if (block) {
        if (Date.now() - (lastUseBlock.get(bot) ?? 0) < USE_BLOCK_COOLDOWN_MS)
          return;
        lastUseBlock.set(bot, Date.now());
        bot.activateBlock(block).catch(() => undefined);
        return;
      }
      useHeldItem(bot);
    },
  },
  // right click without a target: eat, raise a shield, draw a bow (release shoots)
  useItem: {
    name: 'useItem',
    type: 'binary',
    label: (_input, _o, next) => +next.self.usingItem,
    sample: (o) => !o.self.usingItem,
    apply: (bot, value) => {
      if (!value) {
        if (bot.usingHeldItem) bot.deactivateItem();
      } else if (!bot.usingHeldItem) useHeldItem(bot);
    },
  },
  turn: {
    name: 'turn',
    type: 'value',
    move: true,
    label: (_input, o, next) => wrapAngle(next.self.yaw - o.self.yaw),
    apply: (bot, value) =>
      void bot.look(bot.entity.yaw + value, bot.entity.pitch, false),
  },
};

/** another item must suit this much better than the held one (predicted share) to switch, so close calls don't flip */
const SWITCH_MARGIN = 0.3;

/**
 * Which item to hold, e.g. `hold({ sword: /sword|axe/, bow: /bow/, food: /bread|beef/ })`.
 * Value 0 keeps what's in hand, k switches to category k.
 */
export function hold(categories: Record<string, BrainHoldCategory>): BrainHead {
  const tests = Object.values(categories).map((c) =>
    typeof c === 'function' ? c : (name: string) => c.test(name),
  );
  const categoryOf = (name = '') =>
    name ? tests.findIndex((test) => test(name)) + 1 : 0;
  return {
    name: 'hold',
    type: 'class',
    classes: tests.length + 1,
    // learns which item suits the situation: seeing the held item (or its use),
    // it would learn "keep holding it", as switches are rare, and never switch
    hide: ['held', 'usingItem', 'useTicks'],
    label: (_input, _o, next) => categoryOf(next.self.held) || null,
    // never mid-use: switching cancels a bow draw or a meal
    choose: (p, o) => {
      if (o.self.usingItem) return 0;
      const held = categoryOf(o.self.held);
      let best = 1;
      for (let k = 2; k < p.length; k++) if (p[k] > p[best]) best = k;
      return best !== held && p[best] - (p[held] ?? 0) >= SWITCH_MARGIN
        ? best
        : 0;
    },
    apply: (bot, value) => {
      if (value && categoryOf(bot.heldItem?.name) !== value)
        equipItem(bot, (name) => categoryOf(name) === value);
    },
  };
}

export const DEFAULT_HEADS: BrainHeadName[] = [
  'forward',
  'strafe',
  'jump',
  'sprint',
  'attack',
];

/** holds the first inventory item that matches, via the hotbar when it's there */
export function equipItem(bot: Bot, match: (name: string) => boolean): void {
  const item = bot.inventory.items().find((i) => match(i.name));
  if (!item) return;
  const hotbar = item.slot - bot.inventory.hotbarStart;
  if (hotbar >= 0 && hotbar < 9) bot.setQuickBarSlot(hotbar);
  else bot.equip(item, 'hand').catch(() => undefined);
}

/** a target action's commands on a mineflayer bot */
export function actOnBot(bot: Bot, commands: ActCommand[]): void {
  const ignore = () => undefined;
  for (const command of commands) {
    if (command.do === 'equip') equipItem(bot, (name) => name === command.item);
    else if (command.do === 'draw') bot.activateItem();
    else if (command.do === 'release') bot.deactivateItem();
    else if (command.target.kind === 'block') {
      const { x, y, z, action } = command.target;
      const block = bot.blockAt(new Vec3(x, y, z));
      if (!block) continue;
      if (command.do === 'use')
        bot
          .activateBlock(block, new Vec3(...FACES[action?.face ?? 'up']))
          .catch(ignore);
      else if (!bot.targetDigBlock) bot.dig(block, true).catch(ignore);
    } else {
      const entity = bot.entities[command.target.id as number];
      if (!entity) continue;
      if (command.do === 'use') bot.activateEntity(entity).catch(ignore);
      else if (!UNATTACKABLE.has(entity.name ?? '')) bot.attack(entity);
    }
  }
}
