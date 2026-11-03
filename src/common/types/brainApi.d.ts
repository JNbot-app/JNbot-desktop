// Learned bot behaviour ("brains"): record a player in the JNbot Client, train
// small gradient-boosted tree models, and run them on a mineflayer bot.
// Same authoring rules as pluginApi.d.ts: single-line imports, export-only.

import type { Bot } from 'main/src/workers/workerTypes';
import type { IMcClient } from 'common/types/McClientApi';

export interface BrainBlock {
  name: string;
  solid: boolean;
  liquid: boolean;
  /** block properties, e.g. `{ age: 7 }` for fully grown wheat; undefined when it has none */
  state?: Record<string, string | number | boolean>;
}

/** What to do with a target once in reach; the bot does it itself (see {@link BrainOptions.target}). */
export interface BrainAction {
  /** break a block, attack an entity, right-click either, or draw and release a bow/trident at an entity */
  verb: 'break' | 'attack' | 'use' | 'shoot';
  /** item to hold for it; undefined = whatever is in hand */
  item?: string;
  /** block face to right-click (default 'up'), e.g. 'north' to place a block against its north side */
  face?: 'up' | 'down' | 'north' | 'south' | 'east' | 'west';
}

/** A block found with {@link BrainObservation.findBlocks}, usable as a target. */
export interface BrainBlockTarget extends BrainBlock {
  kind: 'block';
  /** world position as 'x,y,z' */
  id: string;
  /** world block position */
  x: number;
  y: number;
  z: number;
  /** offset from your feet block, for `o.block(dx, dy + 1, dz)` (what's above it) */
  dx: number;
  dy: number;
  dz: number;
  /** distance from your eyes to the block centre (as reach is measured) */
  dist: number;
  /** offset in your facing frame: blocks in front of / to the right of you */
  forward: number;
  right: number;
  /** horizontal angle from your crosshair in radians, positive = to the right */
  angle: number;
  /** set on a candidate: what to do with it (see {@link BrainOptions.target}) */
  action?: BrainAction;
}

export interface BrainEntity {
  kind: 'entity';
  id: number;
  /** short entity type, e.g. 'zombie', 'player' */
  type: string;
  player: boolean;
  hostile: boolean;
  x: number;
  y: number;
  z: number;
  /** velocity in blocks/tick */
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  /** NaN when unknown */
  health: number;
  /** held item name, '' when empty */
  held: string;
  dist: number;
  /** height difference (entity - you) */
  dy: number;
  /** offset in your facing frame: blocks in front of / to the right of you */
  forward: number;
  right: number;
  /** horizontal angle from your crosshair in radians, positive = to the right */
  angle: number;
  /** speed toward you in blocks/tick */
  approach: number;
  /** arrow, trident, fireball, snowball, … */
  projectile: boolean;
  /** how far its current path passes from your body (blocks); with closestIn > 0 and a small value, it's coming at you */
  closest: number;
  /** ticks until it is closest to you; negative when moving away, NaN when not moving */
  closestIn: number;
  /** angle between where it faces and you, radians: 0 = looking straight at you */
  facingMe: number;
  /** ticks since it last shot a projectile, NaN when never seen (a skeleton draws its bow ~20-40 ticks after a shot) */
  sinceShot: number;
  /** its synced values that differ from its defaults, named as in minecraft-data, e.g. `{ wool: 16 }` (a sheared white sheep), `{ baby: true }`, `{ is_ignited: true }`; undefined when all are default */
  state?: BrainBlock['state'];
  /** set on a candidate: what to do with it (see {@link BrainOptions.target}) */
  action?: BrainAction;
}

export interface BrainSelf {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** radians, mineflayer convention */
  yaw: number;
  pitch: number;
  health: number;
  food: number;
  onGround: boolean;
  sprinting: boolean;
  sneaking: boolean;
  usingItem: boolean;
  held: string;
  offHand: string;
  /** ticks the current item use has lasted (bow charge, eating, blocking); 0 when not using */
  useTicks: number;
  /** inventory item counts by name, e.g. `items.arrow` */
  items: Record<string, number>;
}

/** What the brain sees each step. Identical when recording and when running. */
export interface BrainObservation {
  /** ms timestamp */
  t: number;
  self: BrainSelf;
  /** nearby entities, nearest first */
  entities: BrainEntity[];
  /** block at an offset (world axes) from your feet block; beyond the observed cube from the far view (a few seconds old), undefined beyond that */
  block(dx: number, dy: number, dz: number): BrainBlock | undefined;
  /**
   * Blocks in the observed cube that match, nearest first, e.g. fully grown wheat:
   * `o.findBlocks((b) => b.name === 'wheat' && b.state?.age === 7)`. dx/dy/dz are offsets from your feet block.
   * With `far`, also those in the far view; there `match` decides per kind of block (dx/dy/dz are NaN).
   */
  findBlocks(
    match: (block: BrainBlock, dx: number, dy: number, dz: number) => boolean,
    far?: boolean,
  ): BrainBlockTarget[];
}

/** Something to focus: an entity, or a block from {@link BrainObservation.findBlocks}. */
export type BrainTarget = BrainEntity | BrainBlockTarget;

/** What the player did during one step (recorded from the JNbot Client). */
export interface BrainInput {
  /** 1 = forward, -1 = back, 0 = none */
  forward: number;
  /** 1 = right, -1 = left, 0 = none */
  strafe: number;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
  /** entity id or block id ('x,y,z') attacked / broken now or within the next 0.5 s (when training); -1 when unknown; null when none */
  attack: number | string | null;
  use: boolean;
  /** entity id or block id right-clicked now or within the next 0.5 s (when training); -1 when unknown; null when none */
  useOn: number | string | null;
}

/** Feature values; nested objects are flattened to `a.b`, booleans become 0/1. */
export type BrainFeatures = {
  [name: string]: number | boolean | null | undefined | BrainFeatures;
};

/** A learned decision. Built-in heads use the same shape. */
export interface BrainHead {
  name: string;
  /** 'class' predicts one of `classes` (0-based), 'binary' a yes/no, 'value' a number */
  type: 'class' | 'binary' | 'value';
  classes?: number;
  /** label for a recorded step; null skips the step. With a target, `input.forward`/`strafe` are toward/around it (the bot faces its target) */
  label(
    input: BrainInput,
    o: BrainObservation,
    next: BrainObservation,
  ): number | null;
  /** execute the predicted value on the bot */
  apply(bot: Bot, value: number, decision: BrainDecision): void;
  /** controls movement: paused while the bot walks to its target (see {@link BrainRunOptions.navigate}) */
  move?: boolean;
  /** fire a binary head only above this probability, instead of sampling */
  threshold?: number;
  /**
   * Pick randomly by probability (default: the brain's `sample`); false = most likely.
   * A function decides per step, e.g. sample starting an action but not stopping it.
   */
  sample?: boolean | ((o: BrainObservation) => boolean);
  /** pick the value yourself from the prediction (class probabilities, `[p]` for binary, `[value]`), instead of sample/threshold */
  choose?(prediction: number[], o: BrainObservation): number;
  /**
   * Your own fields this head can't see (set to '', false or 0 for it), e.g. `['held']`
   * so a "which item" head learns from the situation instead of copying what you hold.
   */
  hide?: (keyof BrainSelf)[];
}

/** Item name test for {@link BrainConstructor.hold}. */
export type BrainHoldCategory = RegExp | ((itemName: string) => boolean);

/** `useItem` is `use` without right-clicking targets: eating, raising a shield, drawing a bow */
export type BrainHeadName =
  | 'forward'
  | 'strafe'
  | 'jump'
  | 'sprint'
  | 'sneak'
  | 'attack'
  | 'use'
  | 'useItem'
  | 'turn';

export interface BrainObserveOptions {
  /** entities further away are ignored (default 32, so bow targets are seen) */
  entityRadius?: number;
  /** horizontal radius of the observed block cube, seen every step (default 8) */
  blockRadius?: number;
  /** vertical radius of the observed block cube (default 6) */
  blockHeight?: number;
  /** horizontal radius of the far view, seen every 3 s, for `o.findBlocks(match, true)` (default 32, 0 = none) */
  farRadius?: number;
  /** vertical radius of the far view (default 6) */
  farHeight?: number;
}

export interface BrainTrainOptions {
  /** max boosting rounds (default 300) */
  rounds?: number;
  learningRate?: number;
  maxDepth?: number;
  /** min recorded steps per leaf (default 20) */
  minLeaf?: number;
  /** rounds without validation improvement before stopping (default 30) */
  earlyStop?: number;
  /**
   * weight rare actions up so the trees learn when they happen: 0 = off,
   * 1 = fully balanced (default 0.5). Predicted probabilities stay calibrated,
   * so the bot still does them about as often as you did.
   */
  balance?: number;
  /** called while training with the share done (0-1) */
  onProgress?(fraction: number): void;
}

export interface BrainOptions<T extends BrainTarget = BrainTarget> {
  /** storage name; recordings and the model live under it */
  name: string;
  /** decision interval in ms (default 100 = 2 ticks) */
  stepMs?: number;
  observe?: BrainObserveOptions;
  /** fixed-size features of the situation */
  features(o: BrainObservation): BrainFeatures;
  /**
   * Learn what to do and to what: which mob to fight, which crop to harvest.
   * Candidates are entities and/or blocks (`o.findBlocks`); their number and
   * order don't matter. Two decisions are learned, in hindsight from what the
   * player attacks, breaks, right-clicks or aims at within the next 5 s:
   * - the intent: which of `actions` to do next, or nothing. It sees your
   *   `features`, per action how many candidates there are with the lowest and
   *   highest of each of their features (e.g. the youngest crop's `state.age`),
   *   and what it did last (`memory.last`, seconds `since`, `streak` in a row).
   * - which candidate: ranked against the others of that action, so every
   *   thing the player did it to within the 5 s counts (ten plants bone-mealed
   *   in a row are ten right picks). Candidates are ranked as if you faced them
   *   (angle 0), as the bot turns to its target.
   * Every head also sees the chosen target's features as `target.*` (missing
   * when there is none), e.g. to pick a bow for a mob that is high up.
   * `attack` breaks a target block, `use` right-clicks it.
   *
   * Candidates with an `action` are actions rather than things: one candidate per
   * thing and action (breaking grown wheat, bone-mealing young wheat), each labelled
   * only when the player did that action with that item. The bot then does the
   * action itself once in reach: it holds the item (the `hold` head waits), breaks,
   * attacks, right-clicks the face, or draws and releases a bow (the `use`/`useItem`
   * heads wait); `attack` and `use` heads leave such targets alone. A block action
   * that changes nothing around the block for a while (2 s, breaking 8 s) is skipped for 10 s,
   * and so is an action's target out of reach that it doesn't get closer to for 6 s.
   */
  target?: {
    candidates(o: BrainObservation): T[];
    features(o: BrainObservation, target: T): BrainFeatures;
    /**
     * the actions candidates carry (the same objects), one intent each; candidates
     * with another action are ignored. Without it all candidates share one intent.
     */
    actions?: BrainAction[];
    /** the intent also sees what it did last, how long ago and how often in a row (default true) */
    memory?: boolean;
  };
  /** decisions to learn (default: forward, strafe, jump, sprint, attack) */
  heads?: (BrainHeadName | BrainHead)[];
  /**
   * Pick actions randomly by their predicted probability, like the player did
   * (default true). false always takes the most likely action, which never
   * picks actions the player only did sometimes (e.g. strafing).
   */
  sample?: boolean;
  train?: BrainTrainOptions;
}

export interface BrainDecision {
  /** predicted value per head: class index (forward/strafe: 0 = back/left, 1 = none, 2 = forward/right), 0/1 for binary */
  values: Record<string, number>;
  /** chosen target, when `target` is configured and the intent isn't "nothing" */
  target: BrainTarget | null;
  /** with `target`: the chance of each intent (0 = nothing, k = `target.actions[k - 1]`) and the chosen one */
  intent?: { chances: number[]; chosen: number };
  /** while running: the bot is walking to the target and the learned movement heads are paused */
  navigating?: boolean;
}

export interface BrainRecording {
  readonly file: string;
  /** recorded steps so far */
  readonly steps: number;
  stop(): Promise<void>;
}

export interface BrainHeadReport {
  rows: number;
  rounds: number;
  trainLoss: number;
  validLoss: number;
  /** validation balanced accuracy (mean per-class recall) for class/binary heads */
  accuracy?: number;
  /** most useful features, best first */
  topFeatures: string[];
}

export interface BrainReport {
  recordings: number;
  steps: number;
  heads: Record<string, BrainHeadReport>;
  /** how close the player usually was when engaging a target; the learned heads take over within it */
  range?: number;
}

export interface BrainRunOptions {
  /**
   * How to aim: 'target' looks at the chosen target (default when `target` is
   * configured), 'turn' uses the learned turn head, false leaves aiming to you.
   */
  look?: 'target' | 'turn' | false;
  /**
   * Walk to the target with the pathfinder plugin (around walls, up stairs) and
   * let the learned heads act once it is within `range` and in sight (default
   * true when `target` is configured). Targets that can't be reached, or that
   * see no progress while out of range (getting closer or being hit) for `giveUp` seconds (default 5, 0 = never), are
   * ignored for 10 s. false = the learned heads always move the bot (e.g. parkour).
   */
  navigate?: boolean | { range?: number; giveUp?: number };
  /** called every step after the decision is applied */
  onStep?(o: BrainObservation, decision: BrainDecision): void;
}

export interface Brain {
  readonly name: string;
  /** Record the player of a JNbot Client until `stop()` is called. */
  record(client: IMcClient): Promise<BrainRecording>;
  /** Train on all recordings of this brain and save the model. */
  train(options?: BrainTrainOptions): Promise<BrainReport>;
  /** Decide from an observation (loads the saved model on first use). */
  decide(o: BrainObservation): BrainDecision;
  /** Control a bot with the trained model. Returns a stop function. */
  run(bot: Bot, options?: BrainRunOptions): () => void;
  /** Delete all recordings and the model of this brain. */
  reset(): void;
}

export interface BrainConstructor {
  new <T extends BrainTarget = BrainTarget>(options: BrainOptions<T>): Brain;
  /** Threat summary of a set of entities in direction sectors around you (fixed size, order-free). */
  swarm(
    o: BrainObservation,
    options?: {
      filter?: (e: BrainEntity) => boolean;
      sectors?: number;
      rings?: number[];
    },
  ): BrainFeatures;
  /** Distance to walls, drops and hazards along rays around you, in your facing frame. */
  rays(
    o: BrainObservation,
    options?: { count?: number; length?: number },
  ): BrainFeatures;
  /**
   * Head that learns which item to hold, e.g. `Brain.hold({ sword: /sword/, bow: /bow/, food: /bread|beef/ })`.
   * It learns which item suits the situation and switches when another one clearly suits better, never mid-use.
   * Value 0 = keep what's in hand, then one per category in order. Switches via the hotbar.
   */
  hold(categories: Record<string, BrainHoldCategory>): BrainHead;
}
