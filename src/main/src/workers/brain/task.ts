/**
 * Entry of a brain worker (`scriptName: 'brainTask'`), off the main thread and
 * the bots' workers. functions/BrainTrainer.ts spawns and terminates it.
 *   info / model / train  read or train a recording plugin's brain, post the result
 *   drive         stay up and answer each JNbot Client snapshot with a decision
 */
import { parentPort } from 'worker_threads';

import {
  type BrainLearnSettings,
  interactionLabel,
} from '../../../../common/brainSpec';
import type {
  BrainBlock,
  BrainDecision,
} from '../../../../common/types/brainApi';
import {
  type ActCommand,
  Actor,
  type ActTarget,
  actTarget,
  ownedHeads,
} from './actions';
import { Observer, type Snapshot } from './observation';
import {
  loadRecordingBrain,
  recordingBrainInfo,
  recordingBrainModel,
  trainRecordingBrain,
} from './spec';

export interface BrainTask {
  task: 'info' | 'model' | 'train' | 'drive';
  pluginId: string;
  learn?: BrainLearnSettings;
}

/** a decision for the JNbot Client: head values (without the ones the target's action owns), the intent, the target and what to do with it */
export interface BrainDriveDecision {
  values: Record<string, number>;
  intent?: BrainDecision['intent'];
  target: ActTarget | null;
  commands: ActCommand[];
}

/** main → drive worker: a snapshot and the palette blocks it added */
export interface BrainDriveStep {
  drive: Snapshot;
  blocks: BrainBlock[];
}

export type BrainTaskMessage =
  | { brainTask: 'progress'; progress: number }
  | { brainTask: 'done'; result: unknown }
  | { brainTask: 'error'; error: string }
  | { brainTask: 'decision'; decision: BrainDriveDecision };

const post = (message: BrainTaskMessage) => parentPort!.postMessage(message);

function drive(pluginId: string) {
  const { brain, spec, range } = loadRecordingBrain(pluginId);
  const palette: BrainBlock[] = [];
  const observer = new Observer(palette);
  const actor = new Actor();
  parentPort!.on('message', (step: BrainDriveStep) => {
    if (!step?.drive) return;
    palette.push(...step.blocks);
    const o = observer.observe(step.drive);
    const { values, target, intent } = brain.decide(o);
    for (const head of ownedHeads(target)) delete values[head];
    post({
      brainTask: 'decision',
      decision: {
        values,
        intent,
        target: actTarget(target),
        commands: actor.step(target, o.self, o.t),
      },
    });
  });
  return {
    hold: spec.hold,
    range,
    intents: ['Nothing', ...spec.interactions.map(interactionLabel)],
  };
}

export default async function runBrainTask(task: BrainTask) {
  try {
    const result =
      task.task === 'drive'
        ? drive(task.pluginId)
        : task.task === 'info'
          ? recordingBrainInfo(task.pluginId, task.learn)
          : task.task === 'model'
            ? recordingBrainModel(task.pluginId)
            : await trainRecordingBrain(task.pluginId, task.learn, (progress) =>
                post({ brainTask: 'progress', progress }),
              );
    post({ brainTask: 'done', result });
  } catch (error) {
    post({
      brainTask: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
