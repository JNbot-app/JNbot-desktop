import type {
  AutomationDocument,
  AutomationIssue,
  AutomationReplayOptions,
  AutomationReplayOrigin,
  AutomationSessionStatus,
  AutomationStep,
  AutomationTargetDescriptor,
} from './automation';
import { automationId } from './automation';

export interface AutomationExecutionContext {
  document: AutomationDocument;
  options: Required<Pick<AutomationReplayOptions, 'spatialMode'>> &
    Pick<AutomationReplayOptions, 'inputs'>;
  replayOrigin: AutomationReplayOrigin;
  signal: AbortSignal;
}

export interface AutomationTargetAdapter {
  readonly target: AutomationTargetDescriptor;
  prepare(document: AutomationDocument, options: AutomationReplayOptions): Promise<AutomationReplayOrigin>;
  execute(step: AutomationStep, context: AutomationExecutionContext): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export class AutomationPlayer {
  readonly sessionId = automationId('playback');
  readonly done: Promise<AutomationSessionStatus>;

  private readonly controller = new AbortController();
  private readonly listeners = new Set<(status: AutomationSessionStatus) => void>();
  private status: AutomationSessionStatus;
  private paused = false;
  private pausedAt = 0;
  private pausedMs = 0;
  /** how far the replay runs behind the recording, so slow steps delay the rest instead of compressing it */
  private lagMs = 0;
  private pauseWaiters: (() => void)[] = [];
  private activeDelay?: { timer: ReturnType<typeof setTimeout>; startedAt: number; resolve: () => void };

  constructor(
    private readonly document: AutomationDocument,
    private readonly adapter: AutomationTargetAdapter,
    private readonly options: AutomationReplayOptions,
  ) {
    const now = Date.now();
    this.status = {
      sessionId: this.sessionId,
      automationId: document.id,
      target: adapter.target,
      state: 'playing',
      currentStep: 0,
      totalSteps: document.steps.length,
      issues: [],
      startedAt: now,
      updatedAt: now,
    };
    this.done = this.run();
  }

  get snapshot(): AutomationSessionStatus {
    return { ...this.status, issues: [...this.status.issues] };
  }

  onStatus(listener: (status: AutomationSessionStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async pause(message = 'Paused'): Promise<void> {
    if (this.controller.signal.aborted || this.paused || this.status.state === 'completed') return;
    this.paused = true;
    this.pausedAt = Date.now();
    this.interruptDelay();
    await this.adapter.pause();
    this.update({ state: 'paused', message });
  }

  async resume(): Promise<void> {
    if (!this.paused || this.status.state === 'failed') return;
    this.pausedMs += Date.now() - this.pausedAt;
    this.pausedAt = 0;
    await this.adapter.resume();
    this.paused = false;
    this.update({ state: 'playing', message: undefined, error: undefined });
    for (const resolve of this.pauseWaiters.splice(0)) resolve();
  }

  async stop(): Promise<void> {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    this.interruptDelay();
    for (const resolve of this.pauseWaiters.splice(0)) resolve();
    await this.adapter.stop();
    this.update({ state: 'stopped', message: 'Stopped' });
  }

  private async run(): Promise<AutomationSessionStatus> {
    try {
      const replayOrigin = await this.adapter.prepare(this.document, this.options);
      const context: AutomationExecutionContext = {
        document: this.document,
        options: { spatialMode: this.options.spatialMode, inputs: this.options.inputs },
        replayOrigin,
        signal: this.controller.signal,
      };

      for (let index = 0; index < this.document.steps.length && !this.controller.signal.aborted; index += 1) {
        const step = this.document.steps[index];
        if (!step.enabled) continue;
        await this.waitUntil(step.atMs + this.lagMs);
        if (this.controller.signal.aborted) break;
        this.update({
          state: 'playing',
          currentStep: index + 1,
          stepId: step.id,
          message: step.label ?? step.kind,
          error: undefined,
        });

        let retryAfterPause = true;
        while (retryAfterPause && !this.controller.signal.aborted) {
          retryAfterPause = false;
          try {
            await this.adapter.execute(step, context);
          } catch (error) {
            if (this.paused && !this.controller.signal.aborted) {
              await this.waitWhilePaused();
              retryAfterPause = true;
            } else if (!this.controller.signal.aborted) {
              this.addIssue(step, index, error);
            }
          }
        }
        this.trackLag(step);
      }

      if (!this.controller.signal.aborted) {
        await this.adapter.stop();
        this.update({
          state: 'completed',
          currentStep: this.document.steps.length,
          stepId: undefined,
          message: this.status.issues.length ? 'Completed with warnings' : 'Completed',
        });
      }
    } catch (error) {
      if (!this.controller.signal.aborted) {
        await this.adapter.stop().catch(() => undefined);
        this.update({
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
          message: 'Replay could not start',
        });
      }
    }
    return this.snapshot;
  }

  private addIssue(step: AutomationStep, stepIndex: number, error: unknown): void {
    const issue: AutomationIssue = {
      stepId: step.id,
      stepIndex: stepIndex + 1,
      kind: step.kind,
      atMs: step.atMs,
      reason: error instanceof Error ? error.message : String(error),
    };
    this.update({ issues: [...this.status.issues, issue], message: `Skipped ${step.kind}` });
  }

  /** keeps the recorded gap to the next step when this one ended later than recorded */
  private trackLag(step: AutomationStep): void {
    const recordedEnd =
      step.atMs +
      (step.kind === 'movePath' ? (step.points.at(-1)?.atMs ?? step.atMs) - step.atMs : 0);
    this.lagMs = Math.max(this.lagMs, this.elapsedMs() - recordedEnd);
  }

  private elapsedMs(): number {
    return Math.max(0, Date.now() - this.status.startedAt - this.pausedMs - (this.paused ? Date.now() - this.pausedAt : 0));
  }

  private async waitUntil(atMs: number): Promise<void> {
    while (!this.controller.signal.aborted && this.elapsedMs() < atMs) {
      await this.waitWhilePaused();
      const remaining = atMs - this.elapsedMs();
      if (remaining <= 0) return;
      await this.waitActive(Math.min(remaining, 100));
    }
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.controller.signal.aborted)
      await new Promise<void>((resolve) => this.pauseWaiters.push(resolve));
  }

  private waitActive(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const finish = () => {
        if (this.activeDelay?.startedAt === startedAt) this.activeDelay = undefined;
        resolve();
      };
      this.activeDelay = { timer: setTimeout(finish, Math.max(0, ms)), startedAt, resolve: finish };
    });
  }

  private interruptDelay(): void {
    if (!this.activeDelay) return;
    clearTimeout(this.activeDelay.timer);
    this.activeDelay.resolve();
    this.activeDelay = undefined;
  }

  private update(patch: Partial<AutomationSessionStatus>): void {
    this.status = { ...this.status, ...patch, updatedAt: Date.now() };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
