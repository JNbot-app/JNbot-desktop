import {
  automationId,
  type AutomationDocument,
  type AutomationSessionStatus,
} from '../../../../../common/automation';
import type Brain from '../../brain/Brain';
import { loadRecordingBrain } from '../../brain/spec';
import workerScript from '../../lib/workerScript';
import type { Bot } from '../../workerTypes';

const isFinished = (status: AutomationSessionStatus) =>
  status.state === 'stopped' || status.state === 'failed';

/** "Play with AI": runs a recording's learned brain on a bot, with the same session lifecycle as a replay. */
export default class BrainPlayer {
  readonly sessionId = automationId('playback');

  readonly done: Promise<AutomationSessionStatus>;

  #status: AutomationSessionStatus;

  #listeners = new Set<(status: AutomationSessionStatus) => void>();

  #finish!: (status: AutomationSessionStatus) => void;

  #brain?: Brain;

  #stopRun?: () => void;

  constructor(
    private readonly bot: Bot,
    document: AutomationDocument,
  ) {
    const now = Date.now();
    this.#status = {
      sessionId: this.sessionId,
      automationId: document.id,
      target: { kind: 'bot', id: bot.botId, username: bot.username },
      state: 'playing',
      currentStep: 0,
      totalSteps: 0,
      message: 'Learning from your recordings…',
      issues: [],
      startedAt: now,
      updatedAt: now,
    };
    this.done = new Promise((resolve) => (this.#finish = resolve));
    bot.once('end', () => void this.stop());
    void this.#start(document);
  }

  get snapshot(): AutomationSessionStatus {
    return { ...this.#status, issues: [] };
  }

  onStatus(listener: (status: AutomationSessionStatus) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => this.#listeners.delete(listener);
  }

  async #start(document: AutomationDocument) {
    try {
      // trains in its own worker when the examples changed, so this bot keeps ticking
      await workerScript.sendAsync('TRAIN_BRAIN', document.id, {
        timeoutMs: 0,
      });
      this.#brain = loadRecordingBrain(document.id).brain;
      if (this.#status.state === 'playing') this.#run();
    } catch (error) {
      this.#update({
        state: 'failed',
        message: undefined,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #run() {
    this.#stopRun = this.#brain!.run(this.bot);
    this.#update({ state: 'playing', message: 'Playing with AI' });
  }

  async pause(message = 'Paused'): Promise<void> {
    if (this.#status.state !== 'playing') return;
    this.#stopRun?.();
    this.#stopRun = undefined;
    this.#update({ state: 'paused', message });
  }

  async resume(): Promise<void> {
    if (this.#status.state !== 'paused') return;
    if (this.#brain) this.#run();
    else
      this.#update({
        state: 'playing',
        message: 'Learning from your recordings…',
      });
  }

  async stop(): Promise<void> {
    if (isFinished(this.#status)) return;
    this.#stopRun?.();
    this.#stopRun = undefined;
    this.#update({ state: 'stopped', message: 'Stopped' });
  }

  #update(patch: Partial<AutomationSessionStatus>): void {
    this.#status = { ...this.#status, ...patch, updatedAt: Date.now() };
    for (const listener of this.#listeners) listener(this.snapshot);
    if (isFinished(this.#status)) this.#finish(this.snapshot);
  }
}
