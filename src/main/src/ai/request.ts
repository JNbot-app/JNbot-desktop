import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type {
  AiRequestOptions,
  AiPredictOptions,
} from '../../../common/types/pluginApi';
import { aiError } from './schema';
import scheduleDeadline from './deadline';

const handlerContext = new AsyncLocalStorage<boolean>();
export function checkContext(): void {
  if (handlerContext.getStore())
    throw aiError(
      'AI_REENTRANT',
      'A running AI handler cannot recursively call AI.',
    );
}
export function inHandler<T>(work: () => T): T {
  return handlerContext.run(true, work);
}
export function positive(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1)
    throw aiError('AI_INVALID_INPUT', `${name} must be a positive integer.`);
  return result;
}

export function input(text: string, options: AiPredictOptions): number {
  if (typeof text !== 'string')
    throw aiError('AI_INVALID_INPUT', 'text must be a string.');
  positive(options.timeoutMs, 120_000, 'timeoutMs');
  if (options.reasoning !== undefined && typeof options.reasoning !== 'boolean')
    throw aiError('AI_INVALID_INPUT', 'reasoning must be a boolean.');
  return positive(options.maxNewTokens, 512, 'maxNewTokens');
}

export class RequestScope {
  readonly id = randomUUID();

  readonly deadline: number;

  readonly controller = new AbortController();

  private readonly cancelTimer: () => void;

  private readonly signals: AbortSignal[];

  private readonly abort = () =>
    this.controller.abort(aiError('AI_CANCELLED', 'AI request cancelled.'));

  constructor(options: AiRequestOptions, lifetime?: AbortSignal) {
    this.deadline =
      Date.now() + positive(options.timeoutMs, 120_000, 'timeoutMs');
    this.signals = [options.signal, lifetime].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    for (const signal of this.signals) {
      if (signal.aborted) this.abort();
      else signal.addEventListener('abort', this.abort, { once: true });
    }
    this.cancelTimer = scheduleDeadline(this.deadline, () =>
      this.controller.abort(
        aiError('AI_TIMEOUT', 'AI request deadline exceeded.'),
      ),
    );
  }

  check(): void {
    if (this.controller.signal.aborted) throw this.controller.signal.reason;
  }

  async wait<T>(work: () => Promise<T> | T): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.controller.signal.reason);
      this.controller.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => {
          this.check();
          return work();
        })
        .then(resolve, reject)
        .finally(() => {
          this.controller.signal.removeEventListener('abort', abort);
        })
        .catch(reject);
    });
  }

  close(): void {
    this.cancelTimer();
    for (const signal of this.signals)
      signal.removeEventListener('abort', this.abort);
  }
}
