/**
 * Proxy-owned keep-alive round trips. A client echoes keep-alives in the order
 * it received them, so a barrier resolves once everything written before it
 * has reached the client.
 */
import minecraftData from 'minecraft-data';

/** Rejects when `signal` aborts before `promise` settles. */
export function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  message = 'Operation timed out',
): Promise<T> {
  // A plain Error reason (e.g. "x left") explains the abort better than `message`.
  const error = () =>
    signal.reason instanceof Error && signal.reason.name === 'Error'
      ? signal.reason
      : new Error(message);
  if (signal.aborted) return Promise.reject(error());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(error());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Keep-alive ids are varints, i64s or [high, low] pairs depending on the protocol. */
export function normalizeKeepAliveId(value: unknown): string {
  if (Array.isArray(value) && value.length === 2)
    return ((BigInt(value[0]) << 32n) | BigInt(value[1] >>> 0)).toString();
  return String(value ?? '');
}

const i64Versions = new Map<string | number, boolean>();

function keepAliveValue(version: string | number): number | bigint {
  let i64 = i64Versions.get(version);
  if (i64 === undefined) {
    const types = minecraftData(version)?.protocol?.play?.toClient?.types as
      | Record<string, unknown>
      | undefined;
    i64 = JSON.stringify(types?.packet_keep_alive ?? '').includes('i64');
    i64Versions.set(version, i64);
  }
  const id = 1 + Math.floor(Math.random() * 0x7ffffffe);
  return i64 ? BigInt(id) : id;
}

/** Where barriers are written: a participant, which writes in its current phase. */
interface KeepAliveTarget {
  readonly version: string | number;
  send(name: string, data: Record<string, unknown>): void;
}

export class Barriers {
  #pending = new Map<string, () => void>();

  /** Fire-and-forget keep-alive; its echo is consumed without effect. */
  ping(target: KeepAliveTarget): void {
    target.send('keep_alive', { keepAliveId: keepAliveValue(target.version) });
  }

  /** Resolves when the client echoes a fresh keep-alive. */
  wait(target: KeepAliveTarget, signal: AbortSignal): Promise<void> {
    const value = keepAliveValue(target.version);
    const id = normalizeKeepAliveId(value);
    const echoed = new Promise<void>((resolve) => this.#pending.set(id, resolve));
    target.send('keep_alive', { keepAliveId: value });
    return raceAbort(echoed, signal, 'Barrier timed out').finally(() =>
      this.#pending.delete(id),
    );
  }

  /** True when `id` answered one of our barriers. */
  consume(id: unknown): boolean {
    const key = normalizeKeepAliveId(id);
    const resolve = this.#pending.get(key);
    if (!resolve) return false;
    this.#pending.delete(key);
    resolve();
    return true;
  }
}
