/**
 * Folds the JNbot Client's per-tick capture actions (`mc.automation.action`)
 * into one {@link BrainInput} per brain step. Held keys carry over between
 * steps; momentary actions (jump, attack) count if they happened at all.
 */
import type { BrainInput } from '../../../../common/types/brainApi';
import { blockId } from './observation';

type CaptureAction = {
  kind?: string;
  entity?: { sourceRuntimeId?: unknown };
  position?: { x?: unknown; y?: unknown; z?: unknown };
  [key: string]: unknown;
};

const HELD_KEYS = [
  'forward',
  'back',
  'left',
  'right',
  'sprint',
  'sneak',
] as const;

const entityId = (action: CaptureAction) => {
  const id = action.entity?.sourceRuntimeId;
  return typeof id === 'number' ? id : -1;
};

const positionId = (action: CaptureAction) => {
  const { x, y, z } = action.position ?? {};
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number'
    ? blockId(x, y, z)
    : -1;
};

export class InputTracker {
  #keys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
    sneak: false,
  };

  #jump = false;

  #attack: BrainInput['attack'] = null;

  #useOn: BrainInput['useOn'] = null;

  #using = false;

  #used = false;

  push(action: CaptureAction): void {
    switch (action.kind) {
      case 'move':
        for (const key of HELD_KEYS) this.#keys[key] = action[key] === true;
        if (action.jump === true) this.#jump = true;
        return;
      case 'attackEntity':
        this.#attack = entityId(action);
        return;
      case 'useEntity':
        this.#useOn = entityId(action);
        return;
      case 'breakBlock':
        this.#attack = positionId(action);
        return;
      case 'useBlock':
        this.#useOn = positionId(action);
        return;
      case 'useItem':
        this.#using = this.#used = true;
        return;
      case 'releaseUseItem':
        this.#using = false;
    }
  }

  flush(): BrainInput {
    const k = this.#keys;
    const input: BrainInput = {
      forward: +k.forward - +k.back,
      strafe: +k.right - +k.left,
      jump: this.#jump,
      sprint: k.sprint,
      sneak: k.sneak,
      attack: this.#attack,
      use: this.#using || this.#used,
      useOn: this.#useOn,
    };
    this.#jump = this.#used = false;
    this.#attack = this.#useOn = null;
    return input;
  }
}
