import type { ConsoleLogValue } from '../../../../common/mobileClientContract';
import { logText } from '../../../../common/logText';

export type LogValue = ConsoleLogValue;

const MAX_DEPTH = 4;
const MAX_CHILDREN = 50;
const MAX_NODES = 200;
const MAX_STRING_BYTES = 2 * 1024;
export const MAX_LOG_BYTES = 8 * 1024;
export const MAX_LOG_ARGUMENTS = 20;
const TRUNCATED = '[truncated]';

function trimBytes(value: string, limit: number): string {
  if (value.length <= limit && Buffer.byteLength(value) <= limit) return value;
  const suffix = `... ${TRUNCATED}`;
  const maxPrefix = limit - Buffer.byteLength(suffix);
  let prefix = Buffer.from(value.slice(0, limit))
    .subarray(0, maxPrefix)
    .toString('utf8');
  while (Buffer.byteLength(prefix) > maxPrefix) prefix = prefix.slice(0, -1);
  return prefix + suffix;
}

function trimTransportString(value: string, limit = MAX_LOG_BYTES): string {
  const suffix = `... ${TRUNCATED}`;
  let low = 0;
  let high = Math.min(value.length, limit);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      Buffer.byteLength(JSON.stringify(value.slice(0, middle) + suffix)) <=
      limit
    )
      low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low) + suffix;
}

function snapshot(value: unknown): LogValue {
  const seen = new WeakSet<object>();
  const queue: {
    input: unknown;
    depth: number;
    set: (value: LogValue) => void;
  }[] = [];
  const placeholderBytes = Buffer.byteLength(JSON.stringify(TRUNCATED));
  let nodes = 1;
  let remaining = MAX_LOG_BYTES - 128;

  function enqueue(
    input: unknown,
    depth: number,
    set: (value: LogValue) => void,
  ) {
    nodes++;
    remaining -= placeholderBytes + 1;
    set(TRUNCATED);
    queue.push({ input, depth, set });
  }

  function visit(input: unknown, depth: number): LogValue {
    if (remaining < 64) return TRUNCATED;

    if (typeof input === 'string') {
      return trimBytes(input, Math.min(MAX_STRING_BYTES, remaining - 32));
    }
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number')
      return Number.isFinite(input) ? input : String(input);
    if (typeof input === 'bigint')
      return trimBytes(`${input}n`, MAX_STRING_BYTES);
    if (typeof input === 'function') {
      try {
        return `[Function ${trimBytes(input.name || 'anonymous', MAX_STRING_BYTES)}]`;
      } catch {
        return '[Function]';
      }
    }
    if (typeof input === 'symbol' || typeof input === 'undefined')
      return trimBytes(String(input), MAX_STRING_BYTES);
    if (depth >= MAX_DEPTH) return '[object]';
    if (seen.has(input)) return '[Circular]';
    seen.add(input);

    let array: unknown[] | undefined;
    try {
      if (Array.isArray(input)) array = input;
    } catch {
      return '[Uninspectable]';
    }
    if (array) {
      const result: LogValue[] = [];
      try {
        const length = Math.min(array.length, MAX_CHILDREN);
        for (
          let index = 0;
          index < length && remaining >= 64 && nodes < MAX_NODES;
          index++
        ) {
          const descriptor = Object.getOwnPropertyDescriptor(array, index);
          const slot = result.length;
          enqueue(
            descriptor && 'value' in descriptor
              ? descriptor.value
              : '[Getter or empty]',
            depth + 1,
            (value) => {
              result[slot] = value;
            },
          );
        }
        if (array.length > result.length) {
          result.push(TRUNCATED);
          remaining -= placeholderBytes + 1;
        }
      } catch {
        result.push('[Uninspectable]');
        remaining -= Buffer.byteLength(JSON.stringify('[Uninspectable]')) + 1;
      }
      return result;
    }

    const result: Record<string, LogValue> = Object.create(null);
    let count = 0;
    try {
      for (const key in input) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        const previewKey = trimBytes(key, MAX_STRING_BYTES);
        const keyBytes = Buffer.byteLength(JSON.stringify(previewKey)) + 2;
        if (
          count >= MAX_CHILDREN ||
          nodes >= MAX_NODES ||
          remaining < Math.max(64, keyBytes + placeholderBytes + 64)
        ) {
          result[TRUNCATED] = 'More properties omitted';
          remaining -= Buffer.byteLength(
            JSON.stringify({ [TRUNCATED]: 'More properties omitted' }),
          );
          break;
        }
        remaining -= keyBytes;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        enqueue(
          descriptor && 'value' in descriptor ? descriptor.value : '[Getter]',
          depth + 1,
          (value) => {
            result[previewKey] = value;
          },
        );
        count++;
      }
    } catch {
      result[TRUNCATED] = '[Uninspectable]';
      remaining -= Buffer.byteLength(
        JSON.stringify({ [TRUNCATED]: '[Uninspectable]' }),
      );
    }
    try {
      if (input instanceof Error) {
        for (const key of ['name', 'message'] as const) {
          if (remaining < 64 || nodes >= MAX_NODES) break;
          remaining -= Buffer.byteLength(JSON.stringify(key)) + 2;
          enqueue(input[key], depth + 1, (value) => {
            result[key] = value;
          });
        }
      }
    } catch {
      result[TRUNCATED] = '[Uninspectable]';
      remaining -= Buffer.byteLength(
        JSON.stringify({ [TRUNCATED]: '[Uninspectable]' }),
      );
    }
    return result;
  }

  let preview: LogValue = TRUNCATED;
  remaining -= placeholderBytes;
  queue.push({
    input: value,
    depth: 0,
    set: (value) => {
      preview = value;
    },
  });
  // Reserve each level's keys and placeholders before expanding its values.
  for (let index = 0; index < queue.length; index++) {
    const task = queue[index];
    let result = visit(task.input, task.depth);
    if (
      typeof result === 'string' &&
      Buffer.byteLength(JSON.stringify(result)) > remaining + placeholderBytes
    )
      result = trimTransportString(result, remaining + placeholderBytes);
    const bytes =
      typeof result === 'object' && result !== null
        ? 2 // Children were already charged when their placeholders were queued.
        : Buffer.byteLength(JSON.stringify(result));
    remaining -= bytes - placeholderBytes;
    task.set(result);
  }
  const encoded = JSON.stringify(preview);
  return Buffer.byteLength(encoded) <= MAX_LOG_BYTES
    ? preview
    : trimTransportString(encoded);
}

/** One bounded, transportable value per console call. */
export default function snapshotLog(args: unknown[]): LogValue {
  if (args.length === 0) return '';
  if (args.length === 1) return snapshot(args[0]);
  const values = args.slice(0, MAX_LOG_ARGUMENTS);
  if (args.length > MAX_LOG_ARGUMENTS)
    values.push(`[${args.length - MAX_LOG_ARGUMENTS} arguments omitted]`);
  return snapshot(values);
}

export function logLine(value: LogValue, limit = MAX_LOG_BYTES): string {
  return trimBytes(logText(value), limit);
}
