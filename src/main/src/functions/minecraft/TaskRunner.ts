import { createFork, type Task, type TaskContext } from '@xmcl/task';

interface TaskProgress {
  name: string;
  progress: number;
  total: number;
  from?: string;
  to?: string;
  path: string;
  state: string;
}

export class TaskRunner {
  constructor(
    private readonly onProgress: (event: string, data: unknown) => void
  ) {}

  async run<T>(task: Task<T>, channel: string): Promise<T> {
    const fork = createFork();

    const toProgress = (t: Task<unknown>): TaskProgress => ({
      name: t.name,
      progress: t.progress,
      total: t.total,
      from: t.from,
      to: t.to,
      path: t.path,
      state: String(t.state),
    });

    const context: TaskContext = {
      fork,
      onStart: (t) => this.onProgress(channel, toProgress(t)),
      onUpdate: (t) => this.onProgress(channel, toProgress(t)),
      onFailed: (t, error) => {
        this.onProgress(channel, {
          ...toProgress(t),
          error: error?.message ?? String(error),
        });
      },
      onSucceed: (t) => this.onProgress(channel, toProgress(t)),
    };

    return await task.startAndWait(context);
  }

  async runWithRetry<T>(params: {
    createTask: () => Task<T>;
    channel: string;
    maxAttempts: number;
    isRetryable: (error: unknown) => boolean;
    onRetry?: (attempt: number, error: unknown) => void;
  }): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= params.maxAttempts; attempt++) {
      try {
        return await this.run(params.createTask(), params.channel);
      } catch (error) {
        console.error(error);
        lastError = error;

        if (attempt >= params.maxAttempts || !params.isRetryable(error)) {
          break;
        }

        params.onRetry?.(attempt, error);
      }
    }

    throw lastError;
  }
}
