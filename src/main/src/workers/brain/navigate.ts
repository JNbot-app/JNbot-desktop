/**
 * Gets a running brain to its target: walks there with mineflayer-pathfinder
 * (around walls, up stairs) and hands control back to the learned heads once
 * the target is in reach and in sight. Imitation learns *what* to do from a few
 * minutes of play; finding a way through terrain is planning, not imitation.
 */
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

import type { Bot } from '../workerTypes';
import type { BrainTarget } from '../../../../common/types/brainApi';

type Entity = Bot['entity'];
type Block = NonNullable<ReturnType<Bot['blockAt']>>;

/** a chosen target as it is in the bot's world */
export type LiveTarget = {
  id: BrainTarget['id'];
  /** what to look at: the entity's middle or the block's centre */
  position: Vec3;
} & ({ entity: Entity; block?: never } | { block: Block; entity?: never });

/** the bot's live entity or block for a chosen target; null when it's gone */
export function resolveTarget(
  bot: Bot,
  target: BrainTarget | null,
): LiveTarget | null {
  if (target?.kind === 'entity') {
    const entity = bot.entities[target.id];
    return entity
      ? {
          id: target.id,
          entity,
          position: entity.position.offset(0, entity.height / 2, 0),
        }
      : null;
  }
  if (target?.kind === 'block') {
    const block = bot.blockAt(new Vec3(target.x, target.y, target.z));
    return block?.name === target.name
      ? { id: target.id, block, position: block.position.offset(0.5, 0.5, 0.5) }
      : null;
  }
  return null;
}

export interface NavigatorOptions {
  /** ms without progress (closer, a hit, the block changing) before giving up on a target */
  giveUpMs: number;
}

/** how long a target that couldn't be reached is ignored */
const SKIP_MS = 10_000;

export class Navigator {
  readonly #skip = new Map<BrainTarget['id'], number>();

  #target: LiveTarget | null = null;

  #walking = false;

  #best = Infinity;

  #progressAt = 0;

  constructor(
    private readonly bot: Bot,
    private readonly options: NavigatorOptions,
  ) {
    bot.on('path_update', this.#onPath);
    bot.on('entityHurt', this.#onHurt);
    bot.on('blockUpdate', this.#onBlock);
  }

  /** true while the target is ignored because it couldn't be reached */
  skipped = (id: BrainTarget['id']) => (this.#skip.get(id) ?? 0) > Date.now();

  /** walks toward the target until within `range` blocks; true while walking (the learned movement is paused) */
  update(target: LiveTarget | null, range: number): boolean {
    const now = Date.now();
    if (target?.id !== this.#target?.id) {
      this.#stop();
      this.#best = Infinity;
      this.#progressAt = now;
    }
    this.#target = target;
    if (!target) return false;

    // blocks are reached from the eyes, like the observation's block distance
    const dist = target.position.distanceTo(
      target.block ? this.#eye() : this.bot.entity.position,
    );
    // in reach the learned heads fight it (e.g. a skeleton keeping its distance); giving up is for getting there
    if (dist <= range && this.#canSee(target)) {
      this.#best = dist;
      this.#progressAt = now;
      return this.#stop();
    }
    if (dist < this.#best - 1) {
      this.#best = dist;
      this.#progressAt = now;
    } else if (
      this.options.giveUpMs > 0 &&
      now - this.#progressAt > this.options.giveUpMs
    ) {
      this.#giveUp();
      return this.#stop();
    }

    if (!this.#walking) {
      const arrive = Math.max(1, range - 1);
      const { x, y, z } = target.position;
      this.bot.pathfinder.setGoal(
        target.entity
          ? new goals.GoalFollow(target.entity, arrive)
          : new goals.GoalNear(x, y, z, arrive),
        !!target.entity,
      );
      this.#walking = true;
    }
    return true;
  }

  dispose(): void {
    this.bot.off('path_update', this.#onPath);
    this.bot.off('entityHurt', this.#onHurt);
    this.bot.off('blockUpdate', this.#onBlock);
    this.#stop();
  }

  #stop(): false {
    if (this.#walking) this.bot.pathfinder.setGoal(null);
    this.#walking = false;
    return false;
  }

  #giveUp(): void {
    if (this.#target) this.#skip.set(this.#target.id, Date.now() + SKIP_MS);
    this.#target = null;
  }

  #onPath = ({ status }: { status: string }) => {
    if (this.#walking && (status === 'noPath' || status === 'timeout')) {
      this.#giveUp();
      this.#stop();
    }
  };

  #onHurt = (entity: Entity) => {
    if (this.#target?.entity && entity.id === this.#target.entity.id)
      this.#progressAt = Date.now();
  };

  #onBlock = (_old: Block | null, block: Block) => {
    if (this.#target?.block?.position.equals(block.position))
      this.#progressAt = Date.now();
  };

  #eye() {
    const me = this.bot.entity;
    return me.position.offset(0, me.height * 0.9, 0);
  }

  #canSee(target: LiveTarget): boolean {
    const eye = this.#eye();
    const to = target.position.minus(eye);
    const dist = to.norm();
    const hit = (this.bot.world as any).raycast(eye, to.normalize(), dist);
    return !hit || !!target.block?.position.equals(hit.position);
  }
}
