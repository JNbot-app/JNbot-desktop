/**
 * What the player did to things in a recording: every break, hit, right-click
 * and bow shot, with the item in hand and what it changed. Grouped, these are
 * the interactions a recording brain learns to pick from (spec.ts).
 */
import {
  type BrainFace,
  type BrainInteraction,
  type BrainStateValue,
  type BrainVerb,
  DEFAULT_STATE,
} from '../../../../common/brainSpec';
import type {
  BrainBlock,
  BrainObservation,
} from '../../../../common/types/brainApi';
import { FACES, performed } from './actions';
import type { Step } from './recorder';

/** what a click changed shows up within this many steps (1 s) */
const EFFECT_STEPS = 10;
/** an interaction needs this many clicks to count */
const MIN_EVENTS = 3;
/** an item counts as part of an interaction when held for this share of it (else: whatever is in hand) */
const ITEM_SHARE = 0.6;
/** a property value counts as one it's done to when seen this often (a mis-click doesn't); a rule needs this many things in sight it wasn't done to */
const MIN_STATE_EVENTS = 2;
const MIN_STATE_SHARE = 0.03;

interface Event {
  verb: BrainVerb;
  object: string;
  entity: boolean;
  held: string;
  /** null when out of sight */
  effect: string | null;
  around?: Partial<Record<BrainFace, string>>;
  state: BrainBlock['state'];
  /** the states of the other things like it in sight */
  others: BrainBlock['state'][];
}

type State = BrainBlock['state'];

const blockAt = (o: BrainObservation, [x, y, z]: number[]) =>
  o.block(
    x - Math.floor(o.self.x),
    y - Math.floor(o.self.y),
    z - Math.floor(o.self.z),
  );

const offset = (pos: number[], [dx, dy, dz]: number[]) => [
  pos[0] + dx,
  pos[1] + dy,
  pos[2] + dz,
];

const faces = Object.entries(FACES) as [BrainFace, [number, number, number]][];

/** what changed: the block itself ('→name', changed property names), else the first neighbour that changed ('up→wheat') */
function effectAt(
  before: BrainObservation,
  after: BrainObservation,
  pos: number[],
): string | null {
  const a = blockAt(before, pos);
  const b = blockAt(after, pos);
  if (!a || !b) return null;
  if (a.name !== b.name) return `→${b.name}`;
  const keys = Object.keys({ ...a.state, ...b.state }).filter(
    (key) => a.state?.[key] !== b.state?.[key],
  );
  if (keys.length) return keys.sort().join(',');
  for (const [face, delta] of faces) {
    const n = blockAt(before, offset(pos, delta));
    const m = blockAt(after, offset(pos, delta));
    if (n && m && n.name !== m.name) return `${face}→${m.name}`;
  }
  return '';
}

/** what an action changed on a mob: its changed state names ('wool'), '' none or when it's gone */
function entityEffect(before: State, after: State) {
  return Object.keys({ ...before, ...after })
    .filter((key) => before?.[key] !== after?.[key])
    .sort()
    .join(',');
}

/**
 * One event per action: a run of steps with the same action (clicks are
 * spread over the steps before them, a bow is drawn for a while) ends at the
 * click, which is where the item and the thing are read.
 */
export function recordingEvents(
  steps: Step[],
  obs: BrainObservation[],
): Event[] {
  const events: Event[] = [];
  let runs = new Map<string, number>();
  const end = (key: string, start: number, k: number) => {
    const [verb, id] = key.split('|') as [BrainVerb, string];
    const o = obs[k];
    const after = obs[Math.min(k + 1 + EFFECT_STEPS, obs.length - 1)];
    if (/^-?\d+$/.test(id)) {
      const entity = o.entities.find((e) => e.id === +id);
      const later = after.entities.find((e) => e.id === +id);
      if (entity)
        events.push({
          verb,
          object: entity.type,
          entity: true,
          held: o.self.held,
          effect: later
            ? entityEffect(
                obs[start].entities.find((e) => e.id === +id)?.state,
                later.state,
              )
            : '',
          state: entity.state,
          others: o.entities
            .filter((e) => e.type === entity.type && e !== entity)
            .map((e) => e.state),
        });
      return;
    }
    const pos = id.split(',').map(Number);
    const block = blockAt(o, pos);
    if (!block) return;
    const around: Event['around'] = {};
    for (const [face, delta] of faces)
      around[face] = blockAt(obs[start], offset(pos, delta))?.name;
    events.push({
      verb,
      object: block.name,
      entity: false,
      held: o.self.held,
      effect: effectAt(obs[start], after, pos),
      around,
      state: block.state,
      others: o
        .findBlocks((b) => b.name === block.name)
        .filter((b) => b.id !== id)
        .map((b) => b.state),
    });
  };
  for (let k = 0; k + 1 < steps.length; k++) {
    const now = new Map<string, number>();
    if (!steps[k].skip)
      for (const { verb, id } of performed(steps[k].i, obs[k + 1])) {
        const key = `${verb}|${id}`;
        now.set(key, runs.get(key) ?? k);
      }
    for (const [key, start] of runs) if (!now.has(key)) end(key, start, k - 1);
    runs = now;
  }
  for (const [key, start] of runs) end(key, start, steps.length - 2);
  return events;
}

const mostCommon = (values: (string | undefined | null)[]) => {
  const counts = new Map<string, number>();
  for (const v of values)
    if (v !== undefined && v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  for (const [v, n] of counts)
    if (best === undefined || n > counts.get(best)!) best = v;
  return {
    value: best,
    share: best === undefined ? 0 : counts.get(best)! / values.length,
  };
};

const valueOf = (state: State, key: string): BrainStateValue =>
  state?.[key] ?? DEFAULT_STATE;

/**
 * Per property, the values it was done to often enough; a property only counts
 * when the examples show things in sight it wasn't done to (young wheat left
 * alone), so a value that just happened to be the same everywhere isn't a rule.
 */
function seenStates(group: Event[]): BrainInteraction['states'] {
  const min = Math.max(MIN_STATE_EVENTS, group.length * MIN_STATE_SHARE);
  const others = group.flatMap((e) => e.others);
  const rules: NonNullable<BrainInteraction['states']> = {};
  for (const key of new Set(group.flatMap((e) => Object.keys(e.state ?? {})))) {
    const counts = new Map<BrainStateValue, number>();
    for (const { state } of group) {
      const value = valueOf(state, key);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    // a property whose values are all rare varies too much to rule anything out
    const values = [...counts].filter(([, n]) => n >= min).map(([v]) => v);
    const left = others.filter((state) => !values.includes(valueOf(state, key)));
    if (values.length && left.length >= MIN_STATE_EVENTS) rules[key] = values;
  }
  return Object.keys(rules).length ? rules : undefined;
}

/**
 * Groups events into interactions, most done first. Events doing the same to
 * the same kind of thing with the same result are one interaction; its item is
 * the one usually held (seeds on farmland) or none when it varies (opening doors).
 */
export function interactions(events: Event[]): BrainInteraction[] {
  const groups = new Map<string, Event[]>();
  for (const e of events) {
    const key = `${e.verb}|${e.object}|${e.effect ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const found = new Map<string, Event[]>();
  for (const group of groups.values()) {
    const held = mostCommon(group.map((e) => e.held));
    const item = held.share >= ITEM_SHARE ? held.value! : '';
    const { verb, object } = group[0];
    const id = `${verb}|${object}|${item}`;
    found.set(id, [...(found.get(id) ?? []), ...group]);
  }
  return [...found]
    .filter(([, group]) => group.length >= MIN_EVENTS)
    .map(([id, group]): BrainInteraction => {
      const [verb, object, item] = id.split('|') as [BrainVerb, string, string];
      const { entity } = group[0];
      const around: BrainInteraction['around'] = {};
      if (!entity)
        for (const [face] of faces)
          around[face] = mostCommon(group.map((e) => e.around?.[face])).value;
      return {
        id,
        verb,
        object,
        entity,
        item,
        effect: mostCommon(group.map((e) => e.effect)).value ?? '',
        around: entity ? undefined : around,
        states: seenStates(group),
        count: group.length,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** the face an interaction right-clicks: where it puts something, else the top */
export const interactionFace = ({ effect }: BrainInteraction): BrainFace => {
  const face = effect.split('→')[0];
  return face in FACES ? (face as BrainFace) : 'up';
};
