/**
 * Reads and trains recording plugins' brains ("Play with AI") in a short-lived
 * worker, so neither the main process nor a bot's worker stalls while it
 * crunches the examples.
 */
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';

import {
  type BrainInfo,
  type BrainLearnSettings,
  type BrainModelView,
  type BrainTrainStatus,
  recordingBrainName,
} from '../../../common/brainSpec';
import type { BrainReport } from '../../../common/types/brainApi';
import type {
  BrainDriveDecision,
  BrainDriveStep,
  BrainTask,
  BrainTaskMessage,
} from '../workers/brain/task';
import {
  brainDir,
  isRecordingFile,
  takeStepsFile,
} from '../workers/brain/recorder';
import { devicePath } from './storage/portablePaths';
import { workerDataPath, workerEntryPath } from './workerPaths';

/** A trained brain in its own worker, deciding one JNbot Client step at a time. */
export interface BrainDriver {
  /** items the hold head picks between (value k = hold[k - 1]) */
  hold?: string[];
  /** how close the player usually was when engaging a target */
  range?: number;
  /** names of the intents a decision's chances are for (0 = nothing) */
  intents: string[];
  decide(
    snapshot: BrainDriveStep['drive'],
    blocks: BrainDriveStep['blocks'],
  ): Promise<BrainDriveDecision>;
  close(): void;
}

export default class BrainTrainer {
  readonly #training = new Map<string, Promise<BrainReport>>();

  constructor(
    private readonly learnOf: (
      pluginId: string,
    ) => Promise<BrainLearnSettings | undefined>,
  ) {}

  /** `learn` overrides the saved settings (e.g. a goal the editor hasn't saved yet) */
  async info(pluginId: string, learn?: BrainLearnSettings): Promise<BrainInfo> {
    return this.#run<BrainInfo>({
      task: 'info',
      pluginId,
      learn: learn ?? (await this.learnOf(pluginId)),
    });
  }

  /** The saved model, trees included, for the "How it decides" view. */
  model(pluginId: string): Promise<BrainModelView> {
    return this.#run<BrainModelView>({ task: 'model', pluginId });
  }

  /** Trains when the examples or goal changed; concurrent calls share one run. */
  train(pluginId: string): Promise<BrainReport> {
    const running = this.#training.get(pluginId);
    if (running) return running;
    const publish = (status: Omit<BrainTrainStatus, 'pluginId'>) =>
      global.send('BRAIN_TRAIN_STATUS', { pluginId, ...status });
    publish({ state: 'training', progress: 0 });
    const run = this.learnOf(pluginId)
      .then((learn) =>
        this.#run<BrainReport>({ task: 'train', pluginId, learn }, (progress) =>
          publish({ state: 'training', progress }),
        ),
      )
      .then(
        (report) => {
          publish({ state: 'done', progress: 1 });
          return report;
        },
        (error: Error) => {
          publish({ state: 'failed', progress: 0, error: error.message });
          throw error;
        },
      )
      .finally(() => this.#training.delete(pluginId));
    this.#training.set(pluginId, run);
    return run;
  }

  /** Removes one example; the next training run leaves it out. */
  deleteExample(pluginId: string, file: string): void {
    if (!isRecordingFile(file) || path.basename(file) !== file)
      throw new Error('Invalid example');
    const dir = brainDir(devicePath('ai'), recordingBrainName(pluginId));
    const recording = path.join(dir, 'recordings', file);
    fs.rmSync(recording, { force: true });
    fs.rmSync(takeStepsFile(recording), { force: true });
    // nothing else tells the model an example is gone: make it stale
    fs.rmSync(path.join(dir, 'spec.json'), { force: true });
  }

  /** Starts the trained brain in a worker; train first so it's up to date. */
  async drive(pluginId: string): Promise<BrainDriver> {
    const worker = this.#spawn({ task: 'drive', pluginId });
    let pending: {
      resolve: (decision: BrainDriveDecision) => void;
      reject: (error: Error) => void;
    } | null = null;
    const ready = new Promise<Pick<BrainDriver, 'hold' | 'range' | 'intents'>>(
      (resolve, reject) => {
        worker.on('message', (message: BrainTaskMessage) => {
          if (message?.brainTask === 'decision') {
            pending?.resolve(message.decision);
            pending = null;
          } else if (message?.brainTask === 'done')
            resolve(
              message.result as Pick<BrainDriver, 'hold' | 'range' | 'intents'>,
            );
          else if (message?.brainTask === 'error') {
            reject(new Error(message.error));
            void worker.terminate();
          }
        });
        worker.once('error', reject);
        worker.once('exit', () => {
          const error = new Error('The AI worker stopped');
          reject(error);
          pending?.reject(error);
          pending = null;
        });
      },
    );
    return {
      ...(await ready),
      decide: (snapshot, blocks) =>
        new Promise((resolve, reject) => {
          pending = { resolve, reject };
          worker.postMessage({
            drive: snapshot,
            blocks,
          } satisfies BrainDriveStep);
        }),
      close: () => void worker.terminate(),
    };
  }

  #spawn(task: BrainTask) {
    return new Worker(workerEntryPath(), {
      workerData: {
        scriptName: 'brainTask',
        script: 'brain',
        data: task,
        scriptOptions: {},
        paths: { ai: devicePath('ai') },
      },
      env: { MC_DATA_PATH: workerDataPath() },
    });
  }

  #run<T>(task: BrainTask, onProgress?: (progress: number) => void) {
    return new Promise<T>((resolve, reject) => {
      const worker = this.#spawn(task);
      worker.on('message', (message: BrainTaskMessage) => {
        if (message?.brainTask === 'progress') onProgress?.(message.progress);
        else if (
          message?.brainTask === 'done' ||
          message?.brainTask === 'error'
        ) {
          void worker.terminate();
          if (message.brainTask === 'done') resolve(message.result as T);
          else reject(new Error(message.error));
        }
      });
      worker.once('error', reject);
      // settled already unless it died first
      worker.once('exit', () => reject(new Error('The AI worker stopped')));
    });
  }
}
