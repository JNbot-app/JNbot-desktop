/**
 * A learned bot behaviour: record a player in the JNbot Client, train one small
 * tree model per decision ("head"), and run it on a mineflayer bot.
 *
 * Layout under `<userData>/ai/<name>/`:
 *   recordings/*.ndjson.gz  `{p: BlockInfo[]}` palette additions and `{s: Snapshot, i: BrainInput}` steps
 *   model.json           feature names, one model per head, optional target model
 */
import fs from 'fs';
import path from 'path';
import { workerData } from 'worker_threads';

import type { Bot } from '../workerTypes';
import type {
  Brain as BrainApi,
  BrainDecision,
  BrainEntity,
  BrainFeatures,
  BrainHead,
  BrainHeadReport,
  BrainInput,
  BrainObservation,
  BrainOptions,
  BrainRecording,
  BrainReport,
  BrainRunOptions,
  BrainSelf,
  BrainTarget,
  BrainTrainOptions,
} from '../../../../common/types/brainApi';
import type { IMcClient } from '../../../../common/types/McClientApi';
import { Observer, Palette, snapshotBot } from './observation';
import {
  brainDir,
  ExampleWriter,
  isRecordingFile,
  readRecording,
  type Step,
} from './recorder';
import { flatten, rays, swarm } from './features';
import { actOnBot, BUILTIN_HEADS, DEFAULT_HEADS, hold } from './heads';
import { Navigator, resolveTarget } from './navigate';
import {
  Actor,
  BLOCK_REACH,
  didAction,
  engageRange,
  FACES,
  inReach,
  ownedHeads,
  performed,
  targetKey,
} from './actions';
import {
  type Dataset,
  type GbdtModel,
  predict,
  trainGbdt,
  type TrainResult,
} from './gbdt';

const AI_PATH: string =
  workerData?.paths?.ai ?? path.resolve(process.cwd(), 'ai');
/** storage folder of a brain */
export const brainPath = (name: string) => brainDir(AI_PATH, name);
/** 8: block distance from the eyes, far view; 7: memory per candidate, movement toward the target, mob states, failures; 6: an intent head picks what to do, a ranker which thing; 5: action targets are scored as if holding their item; 4: targets can carry actions; 3: targets are scored as if faced; 2: heads can hide self fields */
export const MODEL_VERSION = 8;
/** targets that changed nothing in reach, one `{ v: model version, x: ranker features }` per line: learned as things not to pick */
export const FAILURES_FILE = 'failures.ndjson';
/** validation takes every 5th block of 50 steps (5 s), so it covers the whole recording */
const VALID_BLOCK = 50;
const VALID_EVERY = 5;
/** a step's intent is what the player engages within this time: it explains walking toward it */
const TARGET_HORIZON_MS = 5000;
/** aiming counts as engaging within this distance, or at any distance while drawing a bow */
const AIM_RANGE = 6;
/** self fields the intent can't see: the bot holds an action's item because of the intent, so seeing it would only keep the intent */
const INTENT_HIDE = 'held,usingItem,useTicks';
/** bonus for the current intent and target, so the bot doesn't flip between close calls */
const STICKY = 0.1;
/** learned heads take over this close to the target when the recordings don't tell */
const DEFAULT_RANGE = 4;
/** the `target.*` features heads see: the chosen target's `target.features` */
const TARGET_PREFIX = 'target.';
/** a block action in reach that changes nothing around the block for this long is skipped */
const STALL_MS = { break: 8000, use: 2000 };
/** how long a target is ignored once skipped */
const SKIP_MS = 10_000;
/** a target out of reach is skipped once it hasn't got a block closer for this long (unreachable, or the path is stuck) */
const APPROACH_MS = 6000;
/** a movement head keeps its value while it's at most this much less likely than the best */
const KEEP_MOVE = 0.25;
/** things the memory remembers doing something to */
const MEMORY_THINGS = 256;

/** the block and its neighbours, to notice an action changing anything */
function surroundings(o: BrainObservation, t: BrainTarget): string {
  if (t.kind !== 'block') return '';
  return [[0, 0, 0], ...Object.values(FACES)]
    .map(([dx, dy, dz]) => {
      const b = o.block(t.dx + dx, t.dy + dy, t.dz + dz);
      return b ? `${b.name}${JSON.stringify(b.state ?? '')}` : '?';
    })
    .join(';');
}

export interface SavedModel {
  version: number;
  features: string[];
  heads: Record<string, GbdtModel>;
  /**
   * intent: what to do next (class 0 = nothing, k = the k-th action group);
   * model: ranks the things to do it to; range: how close the player usually got before engaging
   */
  target?: {
    features: string[];
    model: GbdtModel;
    intent: { features: string[]; model: GbdtModel };
    range?: number;
  };
  report: BrainReport;
}

/** Collects rows whose feature names are only known once seen; tables sharing `names` share columns. */
class Table {
  readonly rows: number[][] = [];

  constructor(readonly names = new Map<string, number>()) {}

  add(features: Record<string, number>): void {
    const row: number[] = [];
    for (const [name, value] of Object.entries(features)) {
      let col = this.names.get(name);
      if (col === undefined) this.names.set(name, (col = this.names.size));
      row[col] = value;
    }
    this.rows.push(row);
  }

  /** dense rows, unseen features as NaN */
  dense(indices?: number[]): Float64Array[] {
    const width = this.names.size;
    return (indices ?? this.rows.map((_, i) => i)).map((i) => {
      const out = new Float64Array(width).fill(NaN);
      this.rows[i].forEach((v, c) => (out[c] = v));
      return out;
    });
  }
}

/** a head's {@link BrainHead.hide} as a key; '' sees everything */
const hideKey = (head: BrainHead) => head.hide?.join() ?? '';

/** the observation with these self fields neutral ('', false, 0) */
function blind(o: BrainObservation, hide: string): BrainObservation {
  if (!hide) return o;
  const self: Record<string, unknown> = { ...o.self };
  for (const key of hide.split(',')) {
    const v = self[key];
    self[key] = typeof v === 'string' ? '' : typeof v === 'boolean' ? false : 0;
  }
  return { ...o, self: self as unknown as BrainSelf };
}

/**
 * A candidate as if you faced it. The bot turns to the target it chooses, so
 * where it happens to look must not decide what it chooses: players face what
 * they engage, so the scorer would learn "whatever is in front of me".
 */
const faced = <T extends BrainTarget>(c: T): T => ({
  ...c,
  angle: 0,
  forward: Math.hypot(c.forward, c.right),
  right: 0,
});

/**
 * The candidate the player engaged this step: with an action, the one they did
 * that action to; else what they attacked, broke or right-clicked, else the
 * entity under the crosshair at the end of the step.
 */
function engaged(
  input: BrainInput,
  candidates: BrainTarget[],
  o: BrainObservation,
  next: BrainObservation,
): BrainTarget | null {
  const done = performed(input, next);
  const clicked = [input.attack, input.useOn].find(
    (id) => id !== null && id !== -1,
  );
  const hit = candidates.find((c) =>
    c.action ? didAction(c, done, o, next) : c.id === clicked,
  );
  if (hit) return hit;
  const range = next.self.usingItem ? Infinity : AIM_RANGE;
  let best: BrainTarget | null = null;
  let bestAngle = 0.2;
  for (const c of candidates) {
    if (c.kind !== 'entity' || c.action) continue;
    const e = next.entities.find((n) => n.id === c.id);
    if (e && e.dist < range && Math.abs(e.angle) < bestAngle) {
      best = c;
      bestAngle = Math.abs(e.angle);
    }
  }
  return best;
}

/**
 * The walking keys as seen from the target: forward = toward it, strafe =
 * around it. Players often walk while looking elsewhere; the bot faces its
 * target, so it walks these keys as they are.
 */
function towards(input: BrainInput, t: BrainTarget): BrainInput {
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  return {
    ...input,
    forward: Math.round(input.forward * cos + input.strafe * sin),
    strafe: Math.round(input.strafe * cos - input.forward * sin),
  };
}

/** how a candidate looks: a block itself and the block on its action's face (where seeds go); a mob's state */
function looks(o: BrainObservation, t: BrainTarget): string {
  if (t.kind !== 'block') return JSON.stringify(t.state ?? null);
  const [dx, dy, dz] = FACES[t.action?.face ?? 'up'];
  const b = o.block(t.dx + dx, t.dy + dy, t.dz + dz);
  return JSON.stringify([t.name, t.state, b?.name, b?.state]);
}

/**
 * Hindsight per step, from what the player engaged (`hits`, with how each
 * looked then): the intent is the group of the next thing they engage within
 * `horizon` steps (0 = nothing), and every thing of that group they engage
 * within it is a right pick while it still looks as it did then, so
 * bone-mealing ten plants in a row makes all ten right, but a young plant
 * bone-mealed and then broken isn't a right pick for breaking while young.
 * Walking around a wall toward a mob is labelled with attacking that mob.
 */
function hindsight(
  steps: Step[],
  hits: ({ c: BrainTarget; looks: string } | null)[],
  groupOf: (c: BrainTarget) => number,
  horizon: number,
) {
  const intents = new Array<number>(steps.length).fill(0);
  /** per step: key -> how it looked when engaged */
  const picks: Map<string, string>[] = [];
  /** the next thing engaged, the target the heads see */
  const next: (string | null)[] = new Array(steps.length).fill(null);
  let ahead: { k: number; key: string; group: number; looks: string }[] = [];
  for (let k = steps.length - 1; k >= 0; k--) {
    if (steps[k].skip) ahead = [];
    const hit = hits[k];
    if (hit)
      ahead.unshift({
        k,
        key: targetKey(hit.c),
        group: groupOf(hit.c),
        looks: hit.looks,
      });
    while (ahead.length && ahead[ahead.length - 1].k - k > horizon) ahead.pop();
    if (!ahead.length) continue;
    const [first] = ahead;
    intents[k] = first.group;
    next[k] = first.key;
    // the earliest look of each thing: the one before the player changed it
    picks[k] = new Map(
      ahead
        .filter((a) => a.group === first.group)
        .reverse()
        .map((a) => [a.key, a.looks]),
    );
  }
  return { intents, picks, next };
}

/**
 * What the brain did last, as features: the intent group, seconds since, and
 * times in a row (on different things); per candidate, how far it is from the
 * last thing (the next log of the same tree) and seconds since it last did
 * that to it (a sheep it just fed).
 */
class Memory {
  #group = 0;

  #key = '';

  #at = NaN;

  #streak = 0;

  #pos?: [number, number, number];

  /** `group|key` -> when last done, oldest first */
  #done = new Map<string, number>();

  features(t: number): BrainFeatures {
    return {
      last: this.#group - 1,
      since: (t - this.#at) / 1000,
      streak: this.#streak,
    };
  }

  about(c: BrainTarget, group: number, t: number): BrainFeatures {
    const pos = this.#pos;
    const at = this.#done.get(`${group}|${targetKey(c)}`);
    return {
      fromLast: pos ? Math.hypot(c.x - pos[0], c.y - pos[1], c.z - pos[2]) : NaN,
      since: at === undefined ? NaN : (t - at) / 1000,
    };
  }

  did(c: BrainTarget, group: number, t: number): void {
    const key = targetKey(c);
    if (key !== this.#key) {
      this.#streak = group === this.#group ? this.#streak + 1 : 1;
      this.#group = group;
      this.#key = key;
    }
    this.#at = t;
    this.#pos = [c.x, c.y, c.z];
    const done = `${group}|${key}`;
    this.#done.delete(done);
    this.#done.set(done, t);
    if (this.#done.size > MEMORY_THINGS)
      this.#done.delete(this.#done.keys().next().value!);
  }
}

/** a candidate with its features as if faced */
type Candidate = { c: BrainTarget; x: Record<string, number> };

/** per intent group: how many things to do it to, and the lowest and highest of each of their features (the youngest crop's age, the nearest mob) */
function intentContext(groups: Candidate[][]): Record<string, number> {
  const out: Record<string, number> = {};
  groups.forEach((rows, g) => {
    if (!g) return;
    out[`intent.${g}.count`] = rows.length;
    const min: Record<string, number> = {};
    const max: Record<string, number> = {};
    for (const { x } of rows)
      for (const [name, v] of Object.entries(x)) {
        if (Number.isNaN(v)) continue;
        if (min[name] === undefined || v < min[name]) min[name] = v;
        if (max[name] === undefined || v > max[name]) max[name] = v;
      }
    for (const name of Object.keys(min)) {
      out[`intent.${g}.${name}.min`] = min[name];
      out[`intent.${g}.${name}.max`] = max[name];
    }
  });
  return out;
}

const percentile = (values: number[], p: number) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]
    : undefined;

function splitRows(indices: number[]) {
  const isValid = (k: number) =>
    Math.floor(k / VALID_BLOCK) % VALID_EVERY === VALID_EVERY - 1;
  return {
    train: indices.filter((_, k) => !isValid(k)),
    valid: indices.filter((_, k) => isValid(k)),
  };
}

async function fit(
  table: Table,
  labels: (number | null)[],
  head: Pick<BrainHead, 'type' | 'classes'>,
  options: BrainTrainOptions,
): Promise<{ result: TrainResult; report: BrainHeadReport } | null> {
  const indices = labels.flatMap((y, i) =>
    y === null || !Number.isFinite(y) ? [] : [i],
  );
  if (indices.length < 50) return null;
  const { train, valid } = splitRows(indices);
  const dataset = (rows: number[]): Dataset => ({
    x: table.dense(rows),
    y: rows.map((i) => labels[i]!),
  });
  const objective =
    head.type === 'class'
      ? 'multiclass'
      : head.type === 'binary'
        ? 'binary'
        : 'regression';
  const result = await trainGbdt(
    dataset(train),
    dataset(valid),
    table.names.size,
    objective,
    head.classes ?? 2,
    options,
  );
  const names = [...table.names.keys()];
  return {
    result,
    report: {
      rows: indices.length,
      rounds: result.rounds,
      trainLoss: result.trainLoss,
      validLoss: result.validLoss,
      accuracy: result.accuracy,
      topFeatures: [...result.gain.keys()]
        .filter((f) => result.gain[f] > 0)
        .sort((a, b) => result.gain[b] - result.gain[a])
        .slice(0, 8)
        .map((f) => names[f]),
    },
  };
}

/** full-charge arrow speed (blocks/tick) and gravity (blocks/tick²) */
const ARROW_SPEED = 3;
const ARROW_GRAVITY = 0.05;

/** the target's chest; with a bow, ahead of it and higher to cover flight time and arrow drop */
function aimPoint(bot: Bot, target: Bot['entity'], seen: BrainEntity) {
  const chest = target.position.offset(0, target.height * 0.85, 0);
  if (!/bow|trident/.test(bot.heldItem?.name ?? '')) return chest;
  const ticks =
    chest.distanceTo(bot.entity.position.offset(0, bot.entity.height, 0)) /
    ARROW_SPEED;
  return chest.offset(
    seen.vx * ticks,
    0.5 * ARROW_GRAVITY * ticks * ticks,
    seen.vz * ticks,
  );
}

export default class Brain implements BrainApi {
  static swarm = swarm;

  static rays = rays;

  static hold = hold;

  readonly name: string;

  #options: BrainOptions;

  #heads: BrainHead[];

  #model: SavedModel | null = null;

  #warnedMissing = false;

  /** the target chosen last (its {@link targetKey}), kept unless another is clearly better */
  #current: string | undefined;

  /** the intent group chosen last, kept unless another is clearly likelier */
  #intent = 0;

  #memory = new Memory();

  /** movement head -> the value it sampled last */
  #moves = new Map<string, number>();

  /** target key -> until when it's ignored */
  #skips = new Map<string, number>();

  /** a block action in reach, waiting for it to change something */
  #stall?: { key: string; since: number; around: string };

  /** a target out of reach, waiting to get closer */
  #approach?: { key: string; since: number; best: number };

  /** the ranker features of the target chosen last */
  #picked?: Record<string, number>;

  constructor(options: BrainOptions) {
    if (!options?.name) throw new Error('Brain needs a name');
    if (typeof options.features !== 'function')
      throw new Error('Brain needs a features(o) function');
    this.name = options.name;
    this.#options = options;
    this.#heads = (options.heads ?? DEFAULT_HEADS).map((head) => {
      if (typeof head !== 'string') return head;
      if (!BUILTIN_HEADS[head])
        throw new Error(
          `Unknown head "${head}". Choose from: ${Object.keys(BUILTIN_HEADS).join(', ')}`,
        );
      return BUILTIN_HEADS[head];
    });
  }

  get #dir() {
    return brainPath(this.name);
  }

  get #recordingsDir() {
    return path.join(this.#dir, 'recordings');
  }

  get #stepMs() {
    return this.#options.stepMs ?? 100;
  }

  /** intent classes: nothing, then one per action (or one for all candidates without `target.actions`) */
  get #classes() {
    return 1 + (this.#options.target?.actions?.length ?? 1);
  }

  /** a candidate's intent group; 0 when its action isn't one of `target.actions` */
  #groupOf(c: BrainTarget) {
    const { actions } = this.#options.target!;
    return actions ? actions.indexOf(c.action!) + 1 : 1;
  }

  /** the candidates by intent group (index 0 stays empty) */
  #groups(o: BrainObservation, keep?: (c: BrainTarget) => boolean) {
    const target = this.#options.target!;
    const groups = Array.from(
      { length: this.#classes },
      () => [] as Candidate[],
    );
    for (const c of target.candidates(o)) {
      const g = this.#groupOf(c);
      if (g && (!keep || keep(c)))
        groups[g].push({ c, x: flatten(target.features(o, faced(c))) });
    }
    return groups;
  }

  /** the candidates' features with what the memory knows about each */
  #remembered(groups: Candidate[][], memory: Memory, t: number) {
    if (this.#options.target!.memory === false) return groups;
    return groups.map((rows, g) =>
      rows.map(({ c, x }) => ({
        c,
        x: flatten(memory.about(c, g, t), { ...x }, 'memory.'),
      })),
    );
  }

  /** what the intent head sees: the user's features, what there is to do and what it did last */
  #intentFeatures(o: BrainObservation, groups: Candidate[][], memory: Memory) {
    const out = flatten(this.#options.features(blind(o, INTENT_HIDE)));
    Object.assign(out, intentContext(groups));
    return this.#options.target!.memory === false
      ? out
      : flatten(memory.features(o.t), out, 'memory.');
  }

  async record(client: IMcClient): Promise<BrainRecording> {
    const writer = new ExampleWriter(this.#recordingsDir, client, {
      stepMs: this.#stepMs,
      observe: this.#options.observe,
      label: this.name,
    });
    const off = await client.on('input', (action) => writer.push(action));
    const origin = await client.getCurrentPosition();
    const sessionId = `brain-${Date.now()}`;
    // makes the client stream per-tick input (keys, attacks, item use)
    await client.request('mc.automation.capture.start', {
      sessionId,
      origin: {
        x: origin.x,
        y: origin.y,
        z: origin.z,
        yaw: origin.yaw,
        pitch: origin.pitch,
      },
    });
    let stopped = false;

    return {
      file: writer.file,
      get steps() {
        return writer.steps;
      },
      stop: async () => {
        if (stopped) return;
        stopped = true;
        await off();
        await client
          .request('mc.automation.capture.stop', { sessionId })
          .catch(() => undefined);
        await writer.stop();
      },
    };
  }

  async train(options: BrainTrainOptions = {}): Promise<BrainReport> {
    const files = fs.existsSync(this.#recordingsDir)
      ? fs.readdirSync(this.#recordingsDir).filter(isRecordingFile).sort()
      : [];
    if (!files.length)
      throw new Error(
        `No recordings for brain "${this.name}". Record with brain.record(client) first.`,
      );

    const { target } = this.#options;
    const horizon = Math.round(TARGET_HORIZON_MS / this.#stepMs);
    const table = new Table();
    // heads that hide self fields train on a blinded observation's features, in the same columns
    const tables = new Map([['', table]]);
    for (const head of this.#heads)
      if (!tables.has(hideKey(head)))
        tables.set(hideKey(head), new Table(table.names));
    const labels: Record<string, (number | null)[]> = Object.fromEntries(
      this.#heads.map((h) => [h.name, []]),
    );
    const intentTable = new Table();
    const intentLabels: number[] = [];
    const targetTable = new Table();
    const targetLabels: number[] = [];
    const reach: number[] = [];
    let steps = 0;
    // reading the recordings is the first fifth, then one share per model
    const progress = options.onProgress ?? this.#options.train?.onProgress;
    const fits = this.#heads.length + (target ? 2 : 0);
    let done = 0;
    const fitted = () => progress?.(0.2 + (0.8 * ++done) / fits);

    for (const [index, file] of files.entries()) {
      progress?.((0.2 * index) / files.length);
      const { palette, steps: recorded } = readRecording(
        path.join(this.#recordingsDir, file),
      );
      const observer = new Observer(palette);
      const obs = recorded.map((step) => observer.observe(step.s));
      const groups = target ? obs.map((o) => this.#groups(o)) : null;
      // per step: what the player engaged
      const hits = recorded.map((step, k) => {
        if (!groups || k + 1 >= recorded.length || step.skip) return null;
        const c = engaged(
          step.i,
          groups[k].flat().map(({ c }) => c),
          obs[k],
          obs[k + 1],
        );
        return c && { c, looks: looks(obs[k], c) };
      });
      const goals =
        groups && hindsight(recorded, hits, (c) => this.#groupOf(c), horizon);
      const memory = new Memory();
      for (let k = 0; k + 1 < recorded.length; k++) {
        if (recorded[k].skip) continue;
        const o = obs[k];
        let goal: BrainTarget | null = null;
        if (groups && goals) {
          const intent = goals.intents[k];
          const step = this.#remembered(groups[k], memory, o.t);
          intentTable.add(this.#intentFeatures(o, step, memory));
          intentLabels.push(intent);
          // the ranker learns which thing, among those of the intent's group
          const rows = intent ? step[intent] : [];
          const picks = goals.picks[k];
          const right = rows.map(
            ({ c }) => !!picks && picks.get(targetKey(c)) === looks(o, c),
          );
          if (right.includes(true))
            rows.forEach(({ x }, i) => {
              targetTable.add(x);
              targetLabels.push(+right[i]);
            });
          goal =
            rows.find(({ c }) => targetKey(c) === goals.next[k])?.c ?? null;
          const hit = hits[k]?.c;
          if (hit) {
            memory.did(hit, this.#groupOf(hit), o.t);
            reach.push(hit.dist);
          }
        }
        steps++;
        for (const [hide, t] of tables)
          t.add(this.#features(blind(o, hide), goal));
        const input = goal ? towards(recorded[k].i, goal) : recorded[k].i;
        for (const head of this.#heads)
          labels[head.name].push(head.label(input, o, obs[k + 1]));
      }
    }

    // targets that changed nothing in reach: failing is what the player's examples can't show
    const failures = path.join(this.#dir, FAILURES_FILE);
    if (target && fs.existsSync(failures))
      for (const line of fs.readFileSync(failures, 'utf8').split('\n')) {
        if (!line) continue;
        // NaN was saved as null
        const failure = JSON.parse(line, (_, v) => v ?? NaN);
        // features of another version mean something else
        if (failure.v !== MODEL_VERSION) continue;
        targetTable.add(failure.x);
        targetLabels.push(0);
      }

    const train = { ...this.#options.train, ...options };
    const model: SavedModel = {
      version: MODEL_VERSION,
      features: [...table.names.keys()],
      heads: {},
      report: { recordings: files.length, steps, heads: {} },
    };
    for (const head of this.#heads) {
      const result = await fit(
        tables.get(hideKey(head))!,
        labels[head.name],
        head,
        train,
      );
      fitted();
      if (!result) continue;
      model.heads[head.name] = result.result.model;
      model.report.heads[head.name] = result.report;
    }
    if (target) {
      const intent = await fit(
        intentTable,
        intentLabels,
        { type: 'class', classes: this.#classes },
        train,
      );
      fitted();
      const ranker = await fit(
        targetTable,
        targetLabels,
        { type: 'binary' },
        train,
      );
      fitted();
      if (intent && ranker) {
        model.target = {
          features: [...targetTable.names.keys()],
          model: ranker.result.model,
          intent: {
            features: [...intentTable.names.keys()],
            model: intent.result.model,
          },
          range: percentile(reach, 0.9),
        };
        model.report.heads.intent = intent.report;
        model.report.heads.target = ranker.report;
        model.report.range = model.target.range;
      }
    }

    fs.mkdirSync(this.#dir, { recursive: true });
    fs.writeFileSync(path.join(this.#dir, 'model.json'), JSON.stringify(model));
    this.#model = model;
    this.#warnedMissing = false;
    return model.report;
  }

  #load(): SavedModel {
    if (this.#model) return this.#model;
    const file = path.join(this.#dir, 'model.json');
    if (!fs.existsSync(file))
      throw new Error(
        `Brain "${this.name}" is not trained yet. Call brain.train() first.`,
      );
    const model = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedModel;
    if (model.version !== MODEL_VERSION)
      throw new Error(
        `Brain "${this.name}" was trained by another version. Call brain.train() again.`,
      );
    return (this.#model = model);
  }

  /** the user's features, plus `target.*` for the target when there is one */
  #features(o: BrainObservation, target: BrainTarget | null) {
    const out = flatten(this.#options.features(o));
    if (target && this.#options.target)
      flatten(this.#options.target.features(o, target), out, TARGET_PREFIX);
    return out;
  }

  #vector(names: string[], features: Record<string, number>): number[] {
    const x = names.map((name) => features[name] ?? NaN);
    if (this.#warnedMissing) return x;
    // optional groups (`skeleton: undefined` vs `skeleton.dist`, no target) aren't changes
    const root = (name: string) => name.split('.')[0];
    const roots = new Set(Object.keys(features).map(root));
    const changed = (name: string) =>
      !(name in features) &&
      !roots.has(root(name)) &&
      !name.startsWith(TARGET_PREFIX);
    if (names.some(changed)) {
      this.#warnedMissing = true;
      console.warn(
        `[brain:${this.name}] features changed since training; call brain.train() again.`,
      );
    }
    return x;
  }

  /** Samples like the player by default: taking the most likely option would never pick rare actions. */
  #choose(head: BrainHead, out: number[], o: BrainObservation): number {
    if (head.choose) return head.choose(out, o);
    const headSample =
      typeof head.sample === 'function' ? head.sample(o) : head.sample;
    const sample =
      (headSample ?? this.#options.sample ?? true) &&
      head.threshold === undefined;
    if (head.type === 'value') return out[0];
    if (!sample)
      return head.type === 'binary'
        ? +(out[0] >= (head.threshold ?? 0.5))
        : out.indexOf(Math.max(...out));
    const p = head.type === 'binary' ? [1 - out[0], out[0]] : out;
    // players hold keys: keep moving as now while that's nearly as likely as the best, instead of re-rolling every step
    const kept = this.#moves.get(head.name);
    if (head.move && kept !== undefined && p[kept] >= Math.max(...p) - KEEP_MOVE)
      return kept;
    let r = Math.random();
    const k = p.findIndex((v) => (r -= v) < 0);
    const value = k < 0 ? p.length - 1 : k;
    if (head.move) this.#moves.set(head.name, value);
    return value;
  }

  decide(o: BrainObservation): BrainDecision {
    return this.#decide(o);
  }

  /** skip: things to ignore */
  #decide(
    o: BrainObservation,
    skip?: (id: BrainTarget['id']) => boolean,
  ): BrainDecision {
    const model = this.#load();
    let target: BrainTarget | null = null;
    let intent: BrainDecision['intent'];
    if (model.target && this.#options.target) {
      const groups = this.#groups(
        o,
        (c) => !skip?.(c.id) && !((this.#skips.get(targetKey(c)) ?? 0) > o.t),
      );
      ({ target, intent } = this.#pick(
        model.target,
        o,
        this.#remembered(groups, this.#memory, o.t),
      ));
    }
    this.#current = target ? targetKey(target) : undefined;
    this.#checkStall(o, target);
    if (target && inReach(target))
      this.#memory.did(target, this.#groupOf(target), o.t);

    const vectors = new Map<string, number[]>();
    const vector = (hide: string) => {
      let x = vectors.get(hide);
      if (!x)
        vectors.set(
          hide,
          (x = this.#vector(
            model.features,
            this.#features(blind(o, hide), target),
          )),
        );
      return x;
    };
    const values: Record<string, number> = {};
    for (const head of this.#heads) {
      const trained = model.heads[head.name];
      if (!trained) continue;
      values[head.name] = this.#choose(
        head,
        predict(trained, vector(hideKey(head))),
        o,
      );
    }
    return { values, target, intent };
  }

  /**
   * What to do (the likeliest intent with something to do it to; the current
   * one gets a bonus), then which thing: the best ranked of that group.
   * Ranking within the group means ten equally good plants don't each look unlikely.
   */
  #pick(
    saved: NonNullable<SavedModel['target']>,
    o: BrainObservation,
    groups: Candidate[][],
  ): Pick<BrainDecision, 'target' | 'intent'> {
    const x = this.#intentFeatures(o, groups, this.#memory);
    const p = predict(
      saved.intent.model,
      saved.intent.features.map((name) => x[name] ?? NaN),
    );
    groups.forEach((rows, k) => {
      if (k && !rows.length) p[k] = 0;
    });
    const sum = p.reduce((a, b) => a + b, 0) || 1;
    const chances = p.map((v) => v / sum);
    const bonus = (k: number) => chances[k] + (k === this.#intent ? STICKY : 0);
    let chosen = 0;
    for (let k = 1; k < chances.length; k++)
      if (bonus(k) > bonus(chosen)) chosen = k;
    this.#intent = chosen;
    let target: BrainTarget | null = null;
    let best = -Infinity;
    this.#picked = undefined;
    if (chosen)
      for (const { c, x: features } of groups[chosen]) {
        const score =
          predict(
            saved.model,
            saved.features.map((name) => features[name] ?? NaN),
          )[0] + (targetKey(c) === this.#current ? STICKY : 0);
        if (score > best) {
          best = score;
          target = c;
          this.#picked = features;
        }
      }
    return { target, intent: { chances, chosen } };
  }

  /** skips a target it doesn't get closer to, or a block action in reach once it has changed nothing around the block for a while */
  #checkStall(o: BrainObservation, target: BrainTarget | null) {
    // targets without an action may be kept at a distance (a skeleton)
    if (target?.action && !inReach(target)) {
      const key = targetKey(target);
      if (this.#approach?.key !== key || target.dist < this.#approach.best - 1)
        this.#approach = { key, since: o.t, best: target.dist };
      else if (o.t - this.#approach.since > APPROACH_MS) {
        // getting there is the walking's job: the target may be right, so no lesson
        this.#skips.set(key, o.t + SKIP_MS);
        this.#approach = undefined;
      }
    } else this.#approach = undefined;
    const verb = target?.action?.verb;
    if (
      !target ||
      target.kind !== 'block' ||
      (verb !== 'break' && verb !== 'use') ||
      target.dist > BLOCK_REACH
    ) {
      this.#stall = undefined;
      return;
    }
    const key = targetKey(target);
    const around = surroundings(o, target);
    if (this.#stall?.key !== key || this.#stall.around !== around)
      this.#stall = { key, since: o.t, around };
    else if (o.t - this.#stall.since > STALL_MS[verb]) {
      this.#fail(key, o.t);
      this.#stall = undefined;
    }
  }

  /** ignores the target for a while, and saves it so training learns that targets like it fail */
  #fail(key: string, t: number) {
    this.#skips.set(key, t + SKIP_MS);
    if (!this.#picked) return;
    fs.mkdirSync(this.#dir, { recursive: true });
    fs.appendFileSync(
      path.join(this.#dir, FAILURES_FILE),
      `${JSON.stringify({ v: MODEL_VERSION, x: this.#picked })}\n`,
    );
  }

  run(bot: Bot, options: BrainRunOptions = {}): () => void {
    const model = this.#load();
    const palette = new Palette();
    const observer = new Observer(palette.blocks);
    const look = options.look ?? (this.#options.target ? 'target' : false);
    const every = Math.max(1, Math.round(this.#stepMs / 50));
    const navigate = options.navigate ?? !!model.target;
    const nav = typeof navigate === 'object' ? navigate : {};
    if (navigate && !bot.pathfinder)
      console.warn(
        `[brain:${this.name}] enable the pathfinder plugin to walk to targets.`,
      );
    const navigator =
      navigate && bot.pathfinder
        ? new Navigator(bot, { giveUpMs: (nav.giveUp ?? 5) * 1000 })
        : null;
    const range = nav.range ?? model.target?.range ?? DEFAULT_RANGE;
    const actor = new Actor();
    let tick = 0;

    const onTick = () => {
      if (++tick % every) return;
      try {
        const o = observer.observe(
          snapshotBot(bot, this.#options.observe ?? {}, palette),
        );
        const decision = this.#decide(o, navigator?.skipped);
        const target = resolveTarget(bot, decision.target);
        decision.navigating =
          navigator?.update(target, engageRange(decision.target, range)) ??
          false;
        if (look === 'target' && target && !decision.navigating)
          void bot.lookAt(
            target.entity
              ? aimPoint(bot, target.entity, decision.target as BrainEntity)
              : target.position,
            false,
          );
        const owned = ownedHeads(decision.target);
        for (const head of this.#heads) {
          if (owned.includes(head.name)) continue;
          if (head.name === 'turn' && look !== 'turn') continue;
          if (head.move && decision.navigating) continue;
          if (head.name in decision.values)
            head.apply(bot, decision.values[head.name], decision);
        }
        actOnBot(bot, actor.step(decision.target, o.self, o.t));
        options.onStep?.(o, decision);
      } catch (error) {
        console.error(`[brain:${this.name}] step failed:`, error);
        stop();
      }
    };

    const stop = () => {
      bot.off('physicsTick', onTick);
      bot.off('end', stop);
      navigator?.dispose();
      bot.clearControlStates();
    };
    bot.on('physicsTick', onTick);
    bot.once('end', stop);
    return stop;
  }

  reset(): void {
    fs.rmSync(this.#dir, { recursive: true, force: true });
    this.#model = null;
  }
}
