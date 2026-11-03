import type { LaunchLogEntry, MinecraftLaunchLogSnapshot } from '../../types';

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024;

type LaunchLogType = LaunchLogEntry['type'];

type DiagnosticsLimits = {
  maxEntries: number;
  maxBytes: number;
  maxMessageBytes: number;
};

const stringifyOutput = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const truncateMessage = (message: string, maxBytes: number): string => {
  const encoded = Buffer.from(message, 'utf8');
  if (encoded.byteLength <= maxBytes) return message;
  const suffix = Buffer.from('…', 'utf8');
  if (maxBytes <= suffix.byteLength) {
    return encoded.subarray(0, maxBytes).toString('utf8').replace(/�$/u, '');
  }
  let end = maxBytes - suffix.byteLength;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return `${encoded.subarray(0, end).toString('utf8')}…`;
};

export const appendTextTail = (
  current: string,
  chunk: unknown,
  maxBytes: number,
): string => {
  const encoded = Buffer.from(current + stringifyOutput(chunk), 'utf8');
  if (encoded.byteLength <= maxBytes) return encoded.toString('utf8');
  let start = encoded.byteLength - maxBytes;
  while (start < encoded.byteLength && (encoded[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return encoded.subarray(start).toString('utf8');
};

export class LauncherDiagnostics {
  private readonly limits: DiagnosticsLimits;
  private bridgeInstanceId: string | null = null;
  private entries: LaunchLogEntry[] = [];
  private byteCount = 0;
  private sequence = 0;
  private truncated = false;

  constructor(limits: Partial<DiagnosticsLimits> = {}) {
    this.limits = {
      maxEntries: limits.maxEntries ?? DEFAULT_MAX_ENTRIES,
      maxBytes: limits.maxBytes ?? DEFAULT_MAX_BYTES,
      maxMessageBytes: limits.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
    };
  }

  begin(bridgeInstanceId: string): MinecraftLaunchLogSnapshot {
    this.bridgeInstanceId = bridgeInstanceId;
    this.entries = [];
    this.byteCount = 0;
    this.sequence = 0;
    this.truncated = false;
    return this.snapshot();
  }

  append(
    bridgeInstanceId: string,
    message: string,
    type: LaunchLogType = 'info',
  ): LaunchLogEntry | null {
    if (bridgeInstanceId !== this.bridgeInstanceId) return null;

    const normalized = truncateMessage(message, this.limits.maxMessageBytes);
    if (normalized !== message) this.truncated = true;

    this.sequence += 1;
    const entry: LaunchLogEntry = {
      sequence: this.sequence,
      bridgeInstanceId,
      timestamp: Date.now(),
      message: normalized,
      type,
    };
    this.entries.push(entry);
    this.byteCount += Buffer.byteLength(normalized, 'utf8');
    this.trim();
    return this.entries.includes(entry) ? entry : null;
  }

  appendOutput(
    bridgeInstanceId: string,
    chunk: unknown,
    type: Extract<LaunchLogType, 'stdout' | 'stderr'>,
  ): LaunchLogEntry[] {
    const firstSequence = this.sequence;
    stringifyOutput(chunk)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => this.append(bridgeInstanceId, line, type));
    return this.entries.filter((entry) => entry.sequence > firstSequence);
  }

  snapshot(): MinecraftLaunchLogSnapshot {
    return {
      bridgeInstanceId: this.bridgeInstanceId,
      entries: [...this.entries],
      truncated: this.truncated,
    };
  }

  get wasTruncated(): boolean {
    return this.truncated;
  }

  clear(bridgeInstanceId: string): boolean {
    if (bridgeInstanceId !== this.bridgeInstanceId) return false;
    this.entries = [];
    this.byteCount = 0;
    this.truncated = false;
    return true;
  }

  private trim(): void {
    while (
      this.entries.length > this.limits.maxEntries ||
      this.byteCount > this.limits.maxBytes
    ) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.byteCount -= Buffer.byteLength(removed.message, 'utf8');
      this.truncated = true;
    }
  }
}
