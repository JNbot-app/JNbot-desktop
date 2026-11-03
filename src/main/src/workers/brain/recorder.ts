/**
 * Writes brain examples: a snapshot of the JNbot Client every step plus what
 * the player did since the previous one. The caller owns the client's capture
 * stream and feeds its actions in with {@link ExampleWriter.push}, so brain
 * recordings (worker) and app recordings (main process) share this.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

import type {
  BrainBlock,
  BrainInput,
  BrainObserveOptions,
} from '../../../../common/types/brainApi';
import { InputTracker } from './input';
import {
  Palette,
  type Snapshot,
  type SnapshotClient,
  snapshotClient,
} from './observation';

/** storage folder of a brain under the `ai` root */
export const brainDir = (root: string, name: string) =>
  path.join(root, name.replace(/[^\w.-]+/g, '_'));

/** recordings are gzipped ndjson; older ones are plain */
export const isRecordingFile = (file: string) => /\.ndjson(\.gz)?$/.test(file);

/** a take's steps for exact replay, beside its recording */
export const takeStepsFile = (file: string) =>
  file.replace(/\.ndjson(\.gz)?$/, '.steps.json');

/** the lines of a recording; a crash can leave a truncated gzip tail, which is skipped */
const readRecordingText = (file: string) => {
  const data = fs.readFileSync(file);
  return file.endsWith('.gz')
    ? zlib
        .gunzipSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
        .toString('utf8')
    : data.toString('utf8');
};

/** flush the gzip stream this often, so a crash loses at most this many steps */
const FLUSH_STEPS = 100;

/** millimetre / milliradian precision: plenty for features, and compresses far better */
const round = (_key: string, value: unknown) =>
  typeof value === 'number' && !Number.isInteger(value)
    ? Math.round(value * 1000) / 1000
    : value;

export class ExampleWriter {
  readonly file: string;

  steps = 0;

  /** no steps are written while paused, and input in the meantime is dropped */
  paused = false;

  #gzip = zlib.createGzip();

  #closed: Promise<void>;

  #palette = new Palette();

  #tracker = new InputTracker();

  #written = 0;

  #pending: Snapshot | null = null;

  #busy = false;

  #stopped = false;

  #failed = false;

  #timer: ReturnType<typeof setInterval>;

  constructor(
    dir: string,
    client: SnapshotClient,
    options: { stepMs: number; observe?: BrainObserveOptions; label: string },
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(
      dir,
      `${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson.gz`,
    );
    const file = this.#gzip.pipe(fs.createWriteStream(this.file));
    this.#closed = new Promise<void>((resolve) =>
      file.once('close', () => resolve()),
    );
    this.#timer = setInterval(
      () => void this.#step(client, options.observe ?? {}, options.label),
      options.stepMs,
    );
  }

  push(action: Parameters<InputTracker['push']>[0]): void {
    if (!this.paused) this.#tracker.push(action);
  }

  async #step(
    client: SnapshotClient,
    observe: BrainObserveOptions,
    label: string,
  ) {
    if (this.#busy || this.#stopped) return;
    if (this.paused) {
      // a step never spans a pause
      this.#pending = null;
      this.#tracker.flush();
      return;
    }
    this.#busy = true;
    try {
      const snap = await snapshotClient(client, observe, this.#palette);
      if (this.#stopped) return;
      const { blocks } = this.#palette;
      if (blocks.length > this.#written) {
        this.#gzip.write(
          `${JSON.stringify({ p: blocks.slice(this.#written) })}\n`,
        );
        this.#written = blocks.length;
      }
      // input since the previous snapshot is what the player did in response to it
      const input = this.#tracker.flush();
      if (this.#pending) {
        this.#gzip.write(
          `${JSON.stringify({ s: this.#pending, i: input }, round)}\n`,
        );
        if (++this.steps % FLUSH_STEPS === 0) this.#gzip.flush();
      }
      this.#pending = snap;
    } catch (error) {
      if (!this.#failed)
        console.error(`[brain:${label}] snapshot failed:`, error);
      this.#failed = true;
    } finally {
      this.#busy = false;
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    clearInterval(this.#timer);
    this.#gzip.end();
    await this.#closed;
    if (!this.steps) fs.rmSync(this.file, { force: true });
  }
}

/** a click (attack, break, right-click on something) labels the steps leading up to it too: hits are cooldown-limited, the intent isn't */
const ATTACK_WINDOW = 5;
/** runs of this many steps without any input are AFK (e.g. stopping the plugin) and skipped */
const IDLE_STEPS = 30;
export type Step = { s: Snapshot; i: BrainInput; skip?: boolean };

const isIdle = (i: BrainInput) =>
  !i.forward &&
  !i.strafe &&
  !i.jump &&
  !i.sprint &&
  !i.sneak &&
  !i.use &&
  i.attack === null &&
  i.useOn === null;

/** spreads clicks over {@link ATTACK_WINDOW} steps and marks AFK stretches */
function prepare(steps: Step[]): void {
  for (const step of steps) step.i.useOn ??= null; // recorded before it existed
  for (const key of ['attack', 'useOn'] as const) {
    let clicked: BrainInput[typeof key] = null;
    let left = 0;
    for (let k = steps.length - 1; k >= 0; k--) {
      const { i } = steps[k];
      if (i[key] !== null) {
        clicked = i[key];
        left = ATTACK_WINDOW;
      } else if (left > 0) i[key] = clicked;
      left--;
    }
  }
  let start = 0;
  for (let k = 0; k <= steps.length; k++) {
    if (k < steps.length && isIdle(steps[k].i)) continue;
    if (k - start >= IDLE_STEPS)
      for (let j = start; j < k; j++) steps[j].skip = true;
    start = k + 1;
  }
}

export function readRecording(file: string): {
  palette: BrainBlock[];
  steps: Step[];
} {
  const palette: BrainBlock[] = [];
  const steps: Step[] = [];
  for (const line of readRecordingText(file).split('\n')) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.p) palette.push(...entry.p);
      else if (entry.s) steps.push(entry);
    } catch {
      // a crash can leave a partial last line
    }
  }
  prepare(steps);
  return { palette, steps };
}
