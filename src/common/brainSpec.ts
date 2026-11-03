// What a recording plugin's AI learns ("Play with AI"). Plain JSON, so it can
// live in the plugin document and cross IPC; workers/brain/spec.ts turns it
// into a Brain.

import type { BrainAction, BrainBlock, BrainReport } from './types/brainApi';

export type BrainVerb = BrainAction['verb'];
export type BrainFace = NonNullable<BrainAction['face']>;
export type BrainStateValue = NonNullable<BrainBlock['state']>[string];

/** a state rule's value for a mob property it doesn't report: the mob's default (a sheep with its wool) */
export const DEFAULT_STATE = 'default';

/** Something the player did to things, found in the examples (workers/brain/events.ts). */
export interface BrainInteraction {
  /** `verb|object|item` */
  id: string;
  verb: BrainVerb;
  /** block name or entity type */
  object: string;
  entity: boolean;
  /** item held for it; '' = whatever is in hand */
  item: string;
  /** what it usually changed: '→air' (the block became air), 'age' (its properties), 'up→wheat' (a neighbour); '' none seen */
  effect: string;
  /** the blocks usually around it when it was done, by face */
  around?: Partial<Record<BrainFace, string>>;
  /** per property of the block or mob, the values it was done to often enough (e.g. `{ age: [7] }` to harvest wheat): it's never done to others */
  states?: Record<string, BrainStateValue[]>;
  /** times done in the examples */
  count: number;
}

/** learned controls: without `walk` it only walks to the things it works on */
export type BrainControl =
  | 'walk'
  | 'jump'
  | 'sprint'
  | 'sneak'
  | 'useItem'
  | 'hold';

/** what its decisions see (the distance to the chosen thing always) */
export type BrainInputGroup =
  | 'health'
  | 'held'
  | 'motion'
  | 'hostile'
  | 'players'
  | 'projectiles'
  | 'rays'
  | 'thing'
  | 'around'
  | 'memory';

export const BRAIN_INPUT_GROUPS: BrainInputGroup[] = [
  'health',
  'held',
  'motion',
  'hostile',
  'players',
  'projectiles',
  'rays',
  'thing',
  'around',
  'memory',
];

/** What the user chose; undefined = what the examples show. */
export interface BrainLearnSettings {
  /** interaction ids to learn */
  interactions?: string[];
  controls?: BrainControl[];
  inputs?: BrainInputGroup[];
  /** `interactionId|property`: block properties whose value doesn't matter for that interaction */
  anyState?: string[];
}

export interface BrainSpec {
  /** what it picks from, besides doing nothing */
  interactions: BrainInteraction[];
  controls: BrainControl[];
  inputs: BrainInputGroup[];
  /** items the player switched between, learned as a hold head */
  hold?: string[];
}

/** One recorded example (a recording session). */
export interface BrainExample {
  file: string;
  startedAt: number;
  steps: number;
  bytes: number;
  /** recorded before blocks were fully captured (solid, crop age…): worth recording again */
  partial?: boolean;
  /** steps it recorded for exact replay; missing for takes recorded for the AI only */
  actions?: number;
}

/** What the player did in the examples, most frequent first. */
export interface BrainNoticed {
  interactions: BrainInteraction[];
  items: [string, number][];
  /** the controls the examples show */
  controls: BrainControl[];
  /** recorded steps per action */
  actions: Record<'sneak' | 'useItem', number>;
  /** times each action started: one bow shot is one moment, however long the draw */
  moments: Record<BrainMoment, number>;
}

export type BrainMoment = 'attack' | 'use' | 'sneak' | 'jump' | 'switch';

/** a handful of moments is enough for the AI to pick up an action */
export const ENOUGH_MOMENTS = 5;

const MOMENT_NAMES: Record<BrainMoment, string> = {
  attack: 'Attacking',
  use: 'Using items',
  sneak: 'Sneaking',
  jump: 'Jumping',
  switch: 'Switching items',
};

/** actions the player did, but only a few times: worth showing a couple more */
export const rareMoments = (noticed: BrainNoticed) =>
  (Object.keys(MOMENT_NAMES) as BrainMoment[])
    .filter(
      (moment) =>
        noticed.moments[moment] > 0 && noticed.moments[moment] < ENOUGH_MOMENTS,
    )
    .map((moment) => ({
      name: MOMENT_NAMES[moment],
      times: noticed.moments[moment],
    }));

export interface BrainInfo {
  examples: BrainExample[];
  noticed: BrainNoticed;
  /** what training would use: the user's choices over what the examples show */
  spec: BrainSpec;
  /** report of the saved model; stale when examples or the spec changed since */
  model: { report: BrainReport; stale: boolean } | null;
}

/** Flat tree: internal node i splits on `x[f[i]] <= t[i]`; children < 0 are leaves `v[~child]`. */
export interface BrainTree {
  root: number;
  f: number[];
  t: number[];
  l: number[];
  r: number[];
  nanLeft: number[];
  v: number[];
}

export interface BrainGbdt {
  objective: 'binary' | 'regression' | 'multiclass';
  base: number[];
  /** trees[round][class] */
  trees: BrainTree[][];
}

/** A saved model as the "How it decides" view shows it. */
export interface BrainModelView {
  /** what it was trained with */
  spec: BrainSpec;
  report: BrainReport;
  /** per head (plus `target` when it picks targets): the inputs its trees split on, by index */
  heads: Record<string, { features: string[]; model: BrainGbdt }>;
}

export interface BrainTrainStatus {
  pluginId: string;
  state: 'training' | 'done' | 'failed';
  /** 0-1 while training */
  progress: number;
  error?: string;
}

/** brain storage name of a recording plugin; app recordings write its examples */
export const recordingBrainName = (pluginId: string) => `recording-${pluginId}`;

/** decision interval of recording brains (ms) */
export const RECORDING_BRAIN_STEP_MS = 100;

/** recorded time that counts as "enough" examples */
export const ENOUGH_EXAMPLES_MS = 5 * 60_000;

const ACTION_NAMES: Record<string, string> = {
  forward: 'walk forward or back',
  strafe: 'step sideways',
  jump: 'jump',
  sprint: 'sprint',
  attack: 'attack',
  use: 'use items',
  useItem: 'use items',
  sneak: 'sneak',
  hold: 'switch items',
  intent: 'pick what to do',
  target: 'pick which one',
};

/** what a learned action does, in plain words */
export const brainActionName = (head: string) => ACTION_NAMES[head] ?? head;

export const prettyName = (name: string) => name.replace(/_/g, ' ');

/** e.g. "Use bone meal on wheat", "Break wheat" */
export function interactionLabel({ verb, object, item }: BrainInteraction) {
  const thing = prettyName(object);
  const tool = item ? prettyName(item) : '';
  if (verb === 'use') return tool ? `Use ${tool} on ${thing}` : `Use ${thing}`;
  if (verb === 'shoot') return `Shoot ${thing}${tool ? ` with ${tool}` : ''}`;
  return `${verb === 'break' ? 'Break' : 'Attack'} ${thing}${tool ? ` with ${tool}` : ''}`;
}

/** what an interaction usually changed, in plain words ('' when nothing was seen) */
export function interactionEffect({ effect }: BrainInteraction) {
  if (!effect) return '';
  const [where, to] = effect.split('→');
  if (to === undefined) return `changes its ${effect.replace(/,/g, ', ')}`;
  if (!where)
    return to === 'air' ? 'removes it' : `turns it into ${prettyName(to)}`;
  if (to === 'air')
    return `clears its ${where === 'up' ? 'top' : `${where} side`}`;
  return `puts ${prettyName(to)} ${where === 'up' ? 'on top' : where === 'down' ? 'below' : `on its ${where} side`}`;
}

/** consecutive numbers as ranges: [0, 1, 2, 5] → '0–2, 5' */
const valueList = (values: BrainStateValue[]) => {
  const numbers = values.every((v) => typeof v === 'number')
    ? [...(values as number[])].sort((a, b) => a - b)
    : null;
  if (!numbers) return values.join(', ');
  const ranges: string[] = [];
  for (let k = 0; k < numbers.length; ) {
    let end = k;
    while (numbers[end + 1] === numbers[end] + 1) end++;
    ranges.push(end > k ? `${numbers[k]}–${numbers[end]}` : String(numbers[k]));
    k = end + 1;
  }
  return ranges.join(', ');
};

/** a block property an interaction is limited to, in plain words: 'age is 7', 'age is 0–6' */
export const stateRule = (key: string, values: BrainStateValue[]) =>
  `${prettyName(key)} is ${valueList(values)}`;

/** A plain-language verdict on a trained model, with up to three hints. */
export function brainVerdict(report: BrainReport): {
  level: 'good' | 'okay' | 'more';
  hints: string[];
} {
  const minutes = (report.steps * RECORDING_BRAIN_STEP_MS) / 60_000;
  const unsure = Object.entries(report.heads)
    .filter(([, head]) => head.accuracy !== undefined && head.accuracy < 0.6)
    .sort((a, b) => a[1].accuracy! - b[1].accuracy!);
  const hints = unsure
    .slice(0, 2)
    .map(
      ([name]) =>
        `The AI isn't sure when to ${brainActionName(name)}. Show more moments where you do it, and where you don't.`,
    );
  if (report.steps * RECORDING_BRAIN_STEP_MS < ENOUGH_EXAMPLES_MS)
    hints.unshift(
      `You recorded ${minutes.toFixed(1)} min. Around 5 minutes of varied examples works much better.`,
    );
  const level =
    minutes < 1 || unsure.length > 2
      ? 'more'
      : unsure.length || minutes < 5
        ? 'okay'
        : 'good';
  return { level, hints: hints.slice(0, 3) };
}
