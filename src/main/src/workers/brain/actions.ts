/**
 * Target actions ({@link BrainAction}): which one the player did in a recorded
 * step, and doing the chosen one like a player (hold the item, reach, cooldowns,
 * bow draws). {@link Actor} is runtime-free: a mineflayer bot (heads.ts actOnBot)
 * and the JNbot Client (BrainCoach) each map its commands to their own API.
 */
import type {
  BrainAction,
  BrainInput,
  BrainObservation,
  BrainSelf,
  BrainTarget,
} from '../../../../common/types/brainApi';
import type { BrainFace } from '../../../../common/brainSpec';

export const ENTITY_REACH = 3.5;
/** survival reach to a block centre */
export const BLOCK_REACH = 4.5;
/** min ms between clicks: about a sword's cooldown for hits, a quick right-click otherwise */
const COOLDOWN_MS = { attack: 600, use: 250 };
/** ticks of drawing for a full-power bow shot */
const FULL_DRAW = 20;
/** aiming counts within this angle (radians) of the crosshair */
const AIM_ANGLE = 0.2;
const RANGED = /bow|trident/;
/** entities the server kicks for attacking (`invalid_entity_attacked`) */
export const UNATTACKABLE = new Set([
  'item',
  'experience_orb',
  'arrow',
  'spectral_arrow',
  'trident',
]);

/** block offset of each face */
export const FACES: Record<BrainFace, [number, number, number]> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

/** a candidate's identity: the thing, plus the action when it has one (one thing can have several) */
export const targetKey = (t: BrainTarget) =>
  t.action ? `${t.id}|${t.action.verb}|${t.action.item ?? ''}` : String(t.id);

const reachOf = (t: Pick<BrainTarget, 'kind'>) =>
  t.kind === 'entity' ? ENTITY_REACH : BLOCK_REACH;

/** close enough to do the target's action now (a bow shoots from anywhere) */
export const inReach = (t: BrainTarget) =>
  t.action?.verb === 'shoot' || t.dist <= reachOf(t);

/** how close to walk before the bot takes over: in reach for clicks, the learned range otherwise */
export const engageRange = (
  t: Pick<BrainTarget, 'kind' | 'action'> | null,
  range: number,
) => (t?.action && t.action.verb !== 'shoot' ? reachOf(t) - 0.5 : range);

/** the actions the player did this step: clicks, and drawing a bow at an entity */
export function performed(
  input: BrainInput,
  next: BrainObservation,
): { verb: BrainAction['verb']; id: BrainTarget['id'] }[] {
  const done: { verb: BrainAction['verb']; id: BrainTarget['id'] }[] = [];
  if (input.attack !== null && input.attack !== -1)
    done.push({
      verb: typeof input.attack === 'number' ? 'attack' : 'break',
      id: input.attack,
    });
  if (input.useOn !== null && input.useOn !== -1)
    done.push({ verb: 'use', id: input.useOn });
  if (next.self.usingItem && RANGED.test(next.self.held)) {
    const aimed = next.entities.find(
      (e) => !UNATTACKABLE.has(e.type) && Math.abs(e.angle) < AIM_ANGLE,
    );
    if (aimed) done.push({ verb: 'shoot', id: aimed.id });
  }
  return done;
}

/** whether the player did this candidate's action this step, with its item */
export const didAction = (
  c: BrainTarget,
  done: ReturnType<typeof performed>,
  o: BrainObservation,
  next: BrainObservation,
) =>
  !!c.action &&
  (!c.action.item ||
    o.self.held === c.action.item ||
    next.self.held === c.action.item) &&
  done.some((d) => d.id === c.id && d.verb === c.action!.verb);

/** heads that wait while the bot does this target's action */
export function ownedHeads(t: Pick<BrainTarget, 'action'> | null): string[] {
  const action = t?.action;
  if (!action) return [];
  const heads = ['attack', 'use'];
  if (action.item) heads.push('hold');
  if (action.verb === 'shoot') heads.push('useItem');
  return heads;
}

/** the part of a target an action needs; crosses to the JNbot Client runtime */
export type ActTarget = Pick<
  BrainTarget,
  'kind' | 'id' | 'x' | 'y' | 'z' | 'dist' | 'action'
>;

export const actTarget = (t: BrainTarget | null): ActTarget | null =>
  t && {
    kind: t.kind,
    id: t.id,
    x: t.x,
    y: t.y,
    z: t.z,
    dist: t.dist,
    action: t.action,
  };

export type ActCommand =
  | { do: 'equip'; item: string }
  | { do: 'break' | 'attack' | 'use'; target: ActTarget }
  | { do: 'draw' }
  | { do: 'release' };

/** Turns the chosen target's action into this step's commands. */
export class Actor {
  #lastClick = 0;

  #drawing = false;

  step(target: BrainTarget | null, self: BrainSelf, now: number): ActCommand[] {
    const out: ActCommand[] = [];
    const action = target?.action;
    if (this.#drawing && action?.verb !== 'shoot') {
      this.#drawing = false;
      out.push({ do: 'release' });
    }
    if (!target || !action) return out;
    // without the item it still tries: by hand, or the effect check skips it
    if (action.item && self.held !== action.item && self.items[action.item])
      return [...out, { do: 'equip', item: action.item }];
    if (action.verb === 'shoot') {
      if (!this.#drawing) {
        this.#drawing = true;
        return [{ do: 'draw' }];
      }
      if (self.useTicks >= FULL_DRAW) {
        this.#drawing = false;
        return [{ do: 'release' }];
      }
      return out;
    }
    if (target.dist > reachOf(target)) return out;
    const slim = actTarget(target)!;
    // the runtime keeps digging until the block breaks
    if (action.verb === 'break') return [...out, { do: 'break', target: slim }];
    if (now - this.#lastClick < COOLDOWN_MS[action.verb]) return out;
    this.#lastClick = now;
    return [...out, { do: action.verb, target: slim }];
  }
}
