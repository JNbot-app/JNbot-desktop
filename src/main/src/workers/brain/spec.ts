/**
 * Brains for recording plugins ("Play with AI"): the app records examples
 * while the user records the task. What to learn is detected from them; the
 * user only picks the goal, if anything. Training runs in its own worker
 * (functions/BrainTrainer.ts), playing loads the saved model.
 */
import fs from 'fs';
import path from 'path';

import {
  BRAIN_INPUT_GROUPS,
  type BrainControl,
  type BrainExample,
  type BrainFace,
  type BrainInfo,
  type BrainInputGroup,
  type BrainInteraction,
  type BrainLearnSettings,
  type BrainModelView,
  type BrainNoticed,
  type BrainSpec,
  DEFAULT_STATE,
  RECORDING_BRAIN_STEP_MS,
  recordingBrainName,
} from '../../../../common/brainSpec';
import type {
  BrainAction,
  BrainBlock,
  BrainFeatures,
  BrainHeadName,
  BrainObservation,
  BrainOptions,
  BrainReport,
  BrainTarget,
} from '../../../../common/types/brainApi';
import Brain, {
  brainPath,
  FAILURES_FILE,
  MODEL_VERSION,
  type SavedModel,
} from './Brain';
import { FACES } from './actions';
import { interactionFace, interactions, recordingEvents } from './events';
import { rays, swarm } from './features';
import { hold } from './heads';
import { Observer } from './observation';
import { isRecordingFile, readRecording, takeStepsFile } from './recorder';
import type { AutomationTake } from '../../../../common/automation';

/** an action needs this many recorded steps to count as something the player does */
const MIN_STEPS = 10;
/** an item counts as used when held this share of the time */
const MIN_HELD_SHARE = 0.05;
/** candidates per interaction: the nearest ones */
const MAX_CANDIDATES = 8;

const count = (counts: Map<string, number>, key: string) =>
  counts.set(key, (counts.get(key) ?? 0) + 1);

/** keys seen at least `min` times, most frequent first */
const frequent = (counts: [string, number][], min: number) =>
  counts.filter(([, n]) => n >= min).map(([key]) => key);

/** What the player did in the examples: interactions, actions and items they used. */
function analyze(files: string[]) {
  const events: Parameters<typeof interactions>[0] = [];
  const held = new Map<string, number>();
  const actions = { sneak: 0, useItem: 0 };
  const moments: BrainNoticed['moments'] = {
    attack: 0,
    use: 0,
    sneak: 0,
    jump: 0,
    switch: 0,
  };
  const steps: number[] = [];
  /** per file: recorded before the JNbot Client sent solid/liquid/properties */
  const partial: boolean[] = [];
  for (const file of files) {
    const recording = readRecording(file);
    const observer = new Observer(recording.palette);
    const obs = recording.steps.map((step) => observer.observe(step.s));
    events.push(...recordingEvents(recording.steps, obs));
    let active = 0;
    // a moment starts when an action starts: one bow shot is one moment, however long the draw
    let was = {
      attack: false,
      use: false,
      sneak: false,
      jump: false,
      held: '',
    };
    for (const { s, i, skip } of recording.steps) {
      if (skip) {
        was = { ...was, attack: false, use: false, sneak: false, jump: false };
        continue;
      }
      active++;
      const now = {
        attack: i.attack !== null,
        use: i.use || i.useOn !== null,
        sneak: i.sneak,
        jump: i.jump,
        held: s.self.held,
      };
      for (const action of ['attack', 'use', 'sneak', 'jump'] as const)
        if (now[action] && !was[action]) moments[action]++;
      if (was.held && now.held !== was.held) moments.switch++;
      was = now;
      if (s.self.held) count(held, s.self.held);
      if (s.self.usingItem) actions.useItem++;
      if (i.sneak) actions.sneak++;
    }
    steps.push(active);
    partial.push(
      recording.palette.some((b) => b.name !== 'air' && b.solid === undefined),
    );
  }
  const sorted = [...held].sort((a, b) => b[1] - a[1]);
  const items = usedItems(
    sorted,
    steps.reduce((a, b) => a + b, 0),
  );
  const controls: BrainControl[] = ['walk', 'jump', 'sprint'];
  if (actions.sneak >= MIN_STEPS) controls.push('sneak');
  if (actions.useItem >= MIN_STEPS) controls.push('useItem');
  if (items.length > 1) controls.push('hold');
  const noticed: BrainNoticed = {
    interactions: interactions(events),
    items: sorted,
    controls,
    actions,
    moments,
  };
  return { noticed, items, steps, partial };
}

/** items held often enough to count as used */
const usedItems = (items: [string, number][], steps: number) =>
  frequent(items, Math.max(MIN_STEPS, steps * MIN_HELD_SHARE));

/** The spec to train: the user's choices over what the examples show. */
function resolveSpec(
  noticed: BrainNoticed,
  items: string[],
  learn: BrainLearnSettings = {},
): BrainSpec {
  const controls = learn.controls ?? noticed.controls;
  const anyState = new Set(learn.anyState);
  return {
    interactions: noticed.interactions
      .filter((i) => !learn.interactions || learn.interactions.includes(i.id))
      .map((i) => ({
        ...i,
        states:
          i.states &&
          Object.fromEntries(
            Object.entries(i.states).filter(
              ([key]) => !anyState.has(`${i.id}|${key}`),
            ),
          ),
      })),
    controls,
    inputs: (learn.inputs ?? BRAIN_INPUT_GROUPS).filter((group) =>
      BRAIN_INPUT_GROUPS.includes(group),
    ),
    hold: controls.includes('hold') && items.length > 1 ? items : undefined,
  };
}

/** numeric and boolean properties (crop `age`, sheep `wool`); strings can't be features */
const numericState = (state: BrainBlock['state'] = {}) =>
  Object.fromEntries(
    Object.entries(state).filter(([, v]) => typeof v !== 'string'),
  ) as BrainFeatures;

const faces = Object.entries(FACES) as [BrainFace, [number, number, number]][];

/** each side of a block: what's there, and whether it's what was usually there when the player did it */
function aroundFeatures(
  o: BrainObservation,
  c: BrainTarget,
  usual: BrainInteraction['around'] = {},
): BrainFeatures {
  if (c.kind !== 'block') return {};
  const out: BrainFeatures = {};
  for (const [face, [dx, dy, dz]] of faces) {
    const b = o.block(c.dx + dx, c.dy + dy, c.dz + dz);
    out[face] = b && {
      air: /(^|_)air$/.test(b.name),
      solid: b.solid,
      liquid: b.liquid,
      usual: usual[face] === undefined ? undefined : b.name === usual[face],
    };
  }
  return out;
}

export function brainFromSpec(name: string, spec: BrainSpec): Brain {
  const inputs = new Set(spec.inputs);
  const groups: Partial<
    Record<BrainInputGroup, (o: BrainObservation) => BrainFeatures>
  > = {
    health: (o) => ({ health: o.self.health, food: o.self.food }),
    held: (o) => ({
      usingItem: o.self.usingItem,
      useTicks: o.self.useTicks,
      held: spec.hold ? spec.hold.indexOf(o.self.held) : undefined,
    }),
    motion: (o) => ({
      onGround: o.self.onGround,
      vy: o.self.vy,
      pitch: o.self.pitch,
      sneaking: o.self.sneaking,
    }),
    hostile: (o) => swarm(o),
    players: (o) => swarm(o, { filter: (e) => e.player }),
    projectiles: (o) => swarm(o, { filter: (e) => e.projectile }),
    rays: (o) => rays(o),
  };
  const heads: BrainHeadName[] = [];
  for (const control of spec.controls)
    if (control === 'walk') heads.push('forward', 'strafe');
    else if (control !== 'hold') heads.push(control);
  const options: BrainOptions = {
    name,
    stepMs: RECORDING_BRAIN_STEP_MS,
    features: (o) =>
      Object.fromEntries(
        Object.entries(groups)
          .filter(([group]) => inputs.has(group as BrainInputGroup))
          .map(([group, features]) => [group, features(o)]),
      ),
    heads: [
      ...heads,
      ...(spec.hold
        ? [
            hold(
              Object.fromEntries(
                spec.hold.map((item) => [item, (n: string) => n === item]),
              ),
            ),
          ]
        : []),
    ],
  };
  if (spec.interactions.length) options.target = interactionTarget(spec);
  return new Brain(options);
}

/** the player did the interaction to things like this one: none of its properties have a value they never did it to */
const seenState = (t: BrainTarget, { states = {} }: BrainInteraction) =>
  Object.entries(states).every(([key, values]) =>
    values.includes(t.state?.[key] ?? DEFAULT_STATE),
  );

/** what's usually on the face the interaction clicks is there */
function usualFace(o: BrainObservation, t: BrainTarget, i: BrainInteraction) {
  if (t.kind !== 'block') return true;
  const face = interactionFace(i);
  const [dx, dy, dz] = FACES[face];
  const usual = i.around?.[face];
  return (
    usual === undefined ||
    o.block(t.dx + dx, t.dy + dy, t.dz + dz)?.name === usual
  );
}

/**
 * Candidates are (thing, interaction) pairs: per interaction the nearest things
 * it's done to, only in states the player did it to (grown wheat to break,
 * young to bone-meal), those with the usual neighbour on the clicked face first.
 * An action that puts something on that face (seeds) needs it as usual (free).
 */
function interactionTarget(spec: BrainSpec): BrainOptions['target'] {
  const inputs = new Set(spec.inputs);
  const actions: BrainAction[] = spec.interactions.map((i) => ({
    verb: i.verb,
    item: i.item || undefined,
    face: i.entity ? undefined : interactionFace(i),
  }));
  const blockNames = new Set(
    spec.interactions.filter((i) => !i.entity).map((i) => i.object),
  );
  return {
    actions,
    candidates: (o) => {
      // nearest first, up to the far view: work further away is still work
      const blocks = blockNames.size
        ? o.findBlocks((b) => blockNames.has(b.name), true)
        : [];
      return spec.interactions.flatMap((interaction, k) => {
        const usual: BrainTarget[] = [];
        const rest: BrainTarget[] = [];
        const places = interaction.effect.split('→')[0] !== '';
        for (const t of interaction.entity ? o.entities : blocks) {
          if (
            (t.kind === 'entity' ? t.type : t.name) !== interaction.object ||
            !seenState(t, interaction)
          )
            continue;
          if (usualFace(o, t, interaction)) usual.push(t);
          else if (!places) rest.push(t);
        }
        return [...usual, ...rest]
          .slice(0, MAX_CANDIDATES)
          .map((t) => ({ ...t, action: actions[k] }));
      });
    },
    features: (o, c) => {
      const k = actions.indexOf(c.action!);
      const { item, around } = spec.interactions[k];
      const out: BrainFeatures = { kind: k, dist: c.dist, dy: c.dy };
      if (inputs.has('held') && item) out.has = o.self.items[item] ?? 0;
      if (inputs.has('health'))
        Object.assign(out, { health: o.self.health, food: o.self.food });
      if (inputs.has('thing'))
        Object.assign(
          out,
          c.kind === 'entity'
            ? {
                entityHealth: c.health,
                approach: c.approach,
                facingMe: c.facingMe,
                state: numericState(c.state),
              }
            : { state: numericState(c.state) },
        );
      if (inputs.has('around'))
        Object.assign(out, aroundFeatures(o, c, around));
      return out;
    },
    memory: inputs.has('memory'),
  };
}

const paths = (pluginId: string) => {
  const dir = brainPath(recordingBrainName(pluginId));
  return {
    recordings: path.join(dir, 'recordings'),
    model: path.join(dir, 'model.json'),
    spec: path.join(dir, 'spec.json'),
    failures: path.join(dir, FAILURES_FILE),
  };
};

const exampleFiles = (pluginId: string) => {
  const { recordings } = paths(pluginId);
  return fs.existsSync(recordings)
    ? fs
        .readdirSync(recordings)
        .filter(isRecordingFile)
        .sort()
        .map((f) => path.join(recordings, f))
    : [];
};

const takeActions = (file: string) => {
  try {
    return (
      JSON.parse(fs.readFileSync(takeStepsFile(file), 'utf8')) as AutomationTake
    ).steps.length;
  } catch {
    return undefined;
  }
};

/** Examples, what they show, the spec training would use and the saved model's state. */
export function recordingBrainInfo(
  pluginId: string,
  learn?: BrainLearnSettings,
): BrainInfo {
  const files = exampleFiles(pluginId);
  const { noticed, items, steps, partial } = analyze(files);
  const spec = resolveSpec(noticed, items, learn);
  const examples: BrainExample[] = files.map((file, k) => {
    const stat = fs.statSync(file);
    return {
      file: path.basename(file),
      startedAt: stat.birthtimeMs || stat.mtimeMs,
      steps: steps[k],
      partial: partial[k] || undefined,
      bytes: stat.size,
      actions: takeActions(file),
    };
  });
  const { model, spec: specFile, failures } = paths(pluginId);
  if (!fs.existsSync(model)) return { examples, noticed, spec, model: null };
  const { report, version } = JSON.parse(fs.readFileSync(model, 'utf8')) as {
    report: BrainReport;
    version: number;
  };
  const trainedAt = fs.statSync(model).mtimeMs;
  const stale =
    version !== MODEL_VERSION ||
    [...files, failures].some(
      (file) => fs.existsSync(file) && fs.statSync(file).mtimeMs > trainedAt,
    ) ||
    !fs.existsSync(specFile) ||
    fs.readFileSync(specFile, 'utf8') !== JSON.stringify(spec);
  return { examples, noticed, spec, model: { report, stale } };
}

/** Trains the recording plugin's brain when its examples or spec changed; returns the model's report. */
export async function trainRecordingBrain(
  pluginId: string,
  learn: BrainLearnSettings | undefined,
  onProgress: (fraction: number) => void,
): Promise<BrainReport> {
  const info = recordingBrainInfo(pluginId, learn);
  if (info.model && !info.model.stale) return info.model.report;
  if (!info.examples.length)
    throw new Error(
      'Nothing to learn from yet. Record a take first.',
    );
  const brain = brainFromSpec(recordingBrainName(pluginId), info.spec);
  const { model, spec } = paths(pluginId);
  const report = await brain.train({ onProgress });
  if (!Object.keys(report.heads).length) {
    fs.rmSync(model, { force: true });
    throw new Error(
      'Not enough AI examples yet. Record this task for a bit longer.',
    );
  }
  fs.writeFileSync(spec, JSON.stringify(info.spec));
  return report;
}

/** The trained brain of a recording plugin, built from the spec it was trained with. */
export function loadRecordingBrain(pluginId: string) {
  const { spec: specFile, model } = paths(pluginId);
  if (!fs.existsSync(specFile) || !fs.existsSync(model))
    throw new Error('The AI has not learned yet. Record a few examples first.');
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8')) as BrainSpec;
  const { report } = JSON.parse(fs.readFileSync(model, 'utf8')) as {
    report: BrainReport;
  };
  return {
    brain: brainFromSpec(recordingBrainName(pluginId), spec),
    spec,
    /** how close the player usually was when engaging a target */
    range: report.range,
  };
}

/** The saved model and the spec it was trained with, for the "How it decides" view. */
export function recordingBrainModel(pluginId: string): BrainModelView {
  const { spec, model } = paths(pluginId);
  if (!fs.existsSync(spec) || !fs.existsSync(model))
    throw new Error('The AI has not learned yet. Record a few examples first.');
  const saved = JSON.parse(fs.readFileSync(model, 'utf8')) as SavedModel;
  if (saved.version !== MODEL_VERSION)
    throw new Error('The AI learns again when it plays next.');
  const heads: BrainModelView['heads'] = {};
  // what to do and to what first: the decisions the other heads follow
  if (saved.target) {
    heads.intent = saved.target.intent;
    // named as the heads see the chosen target's features
    heads.target = {
      features: saved.target.features.map((name) => `target.${name}`),
      model: saved.target.model,
    };
  }
  for (const [name, head] of Object.entries(saved.heads))
    heads[name] = { features: saved.features, model: head };
  return {
    spec: JSON.parse(fs.readFileSync(spec, 'utf8')) as BrainSpec,
    report: saved.report,
    heads,
  };
}
