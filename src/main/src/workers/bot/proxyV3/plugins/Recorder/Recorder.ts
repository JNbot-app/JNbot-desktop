/**
 * Records the live packet stream (both directions) to disk.
 *
 * This taps the {@link PacketPipeline} instead of a mineflayer bot mirror, so
 * there is no second parser and no world-state dependency. The
 * on-disk format is unchanged ({@link RecordingPacket} NDJSON + a JSON header)
 * with one addition: a `d` direction field. Files land in
 * `workerData.paths.recordings` so the main-process Recordings store reads them.
 */
import fs from 'fs';
import path from 'path';
import { workerData } from 'worker_threads';

import {
  ANY_PACKET,
  PacketContext,
  PacketHandler,
  PacketPipeline,
} from '../../PacketPipeline';
import type {
  RecordingHeader,
  RecordingPacket,
} from '../../../../../../../common/types/proxyApi';

export const RECORDINGS_PATH: string =
  workerData?.paths?.recordings ?? path.resolve(process.cwd(), 'recordings');

export const RECORDER_VERSION = '2.0.0';

export interface DebugCaptureOptions {
  pipeline: PacketPipeline;
  mcVersion: string;
  /** full path without extension; auto-generated under RECORDINGS_PATH if omitted */
  fileName?: string;
  ignorePackets?: string[];
  /**
   * When set, parsed packets whose raw body exceeds this many bytes are stored
   * as a `{ __truncated, bytes }` placeholder instead of their full data, so a
   * debug recording of e.g. chunk packets stays small. 0/undefined keeps full
   * data.
   */
  maxPacketBytes?: number;
  maxDiskBytes: number;
  onLimit?: () => void;
  onFailure?: (error: Error) => void;
}

/** `JSON.stringify` replacer that survives values it normally throws on. */
function jsonSafeReplacer(_key: string, value: unknown): unknown {
  // Minecraft 64-bit fields are decoded as BigInt, which JSON.stringify throws on.
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export class DebugCapture {
  /** absolute path without extension */
  readonly fileName: string;
  /** stable id == base filename */
  readonly id: string;
  readonly timestamp = Date.now();

  stream: fs.WriteStream | null = null;
  packetCount = 0;

  #pipeline: PacketPipeline;
  #mcVersion: string;
  #ignore: Set<string>;
  #maxPacketBytes: number;
  #maxDiskBytes: number;
  #writtenBytes = 0;
  #onLimit?: () => void;
  #onFailure?: (error: Error) => void;
  #handler: PacketHandler | null = null;
  #start = 0;

  constructor(options: DebugCaptureOptions) {
    this.#pipeline = options.pipeline;
    this.#mcVersion = options.mcVersion;
    this.#ignore = new Set(options.ignorePackets ?? ['keep_alive']);
    this.#maxPacketBytes = options.maxPacketBytes ?? 0;
    this.#maxDiskBytes = options.maxDiskBytes;
    this.#onLimit = options.onLimit;
    this.#onFailure = options.onFailure;

    // e.g. debug-2026-10-30_14-32-05 (local time, sorts chronologically)
    const stamp = new Date(this.timestamp)
      .toLocaleString('sv-SE')
      .replace(' ', '_')
      .replace(/:/g, '-');
    const file = path.resolve(
      options.fileName ?? path.join(RECORDINGS_PATH, `debug-${stamp}`),
    );
    this.fileName = file;
    this.id = path.basename(file);
  }

  get metaFilePath(): string {
    return `${this.fileName}.json`;
  }

  get dataFilePath(): string {
    return `${this.fileName}.log`;
  }

  record(): void {
    fs.mkdirSync(path.dirname(this.fileName), { recursive: true });

    fs.writeFileSync(
      this.metaFilePath,
      JSON.stringify({
        id: this.id,
        name: this.id,
        kind: 'debug',
        version: RECORDER_VERSION,
        timestamp: this.timestamp,
        mcVersion: this.#mcVersion,
        ignoredPackets: [...this.#ignore],
        packetCount: 0,
        duration: 0,
      } satisfies RecordingHeader) + '\n',
    );

    this.stream = fs.createWriteStream(this.dataFilePath, { flags: 'a' });
    this.stream.on('error', (err) => {
      console.error('[proxy][recorder] Write stream error:', err);
      this.stop();
      this.#onFailure?.(err);
    });
    this.#start = Date.now();

    this.#handler = (ctx: PacketContext) => this.#onPacket(ctx);
    this.#pipeline.observe(ANY_PACKET, this.#handler);
  }

  #onPacket(ctx: PacketContext): void {
    if (!this.stream || this.#ignore.has(ctx.name)) return;

    // Cheap size gate using the raw body length (avoids serializing huge
    // packets like chunk data just to measure them).
    const oversized =
      this.#maxPacketBytes > 0 &&
      !ctx.unparsed &&
      ctx.buffer.length > this.#maxPacketBytes;

    const packet: RecordingPacket = {
      n: ctx.name,
      dt: Date.now() - this.#start,
      // Packets the proxy couldn't decode are kept (raw bytes) but clearly
      // flagged, so the recording stays complete and the UI can show why.
      p: ctx.unparsed
        ? {
            __unparsed: true,
            error: 'Failed to parse packet',
            raw: ctx.buffer.toString('base64'),
          }
        : oversized
          ? { __truncated: true, bytes: ctx.buffer.length }
          : ctx.data,
      m: {
        sessionId: ctx.sessionId,
        sourceParticipantId: ctx.sourceParticipantId,
        targetParticipantId: ctx.targetParticipantId,
        sequence: ctx.sequence,
        phase: ctx.state,
        origin: ctx.origin,
        bytes: ctx.buffer.length,
        dropped: ctx.isDropped,
        modified: ctx.isModified,
        injections: ctx.injected.length,
        failure: ctx.failure,
      },
      d: ctx.direction,
    };

    const line = this.#serialize(packet);
    if (line === null) return;
    const bytes = Buffer.byteLength(line) + 1;
    if (this.#writtenBytes + bytes > this.#maxDiskBytes) {
      this.stop();
      this.#onLimit?.();
      return;
    }
    this.stream.write(line + '\n');
    this.#writtenBytes += bytes;
    this.packetCount++;
  }

  /**
   * Serializes a packet to one JSON line, tolerant of values `JSON.stringify`
   * chokes on (BigInt longs, Buffers). If serialization still fails the packet
   * is recorded as a flagged placeholder rather than crashing the recorder.
   */
  #serialize(packet: RecordingPacket): string | null {
    try {
      return JSON.stringify(packet, jsonSafeReplacer);
    } catch (error) {
      try {
        return JSON.stringify({
          n: packet.n,
          dt: packet.dt,
          p: { __unserializable: true, error: (error as Error).message },
          m: {},
          d: packet.d,
        } satisfies RecordingPacket);
      } catch {
        return null;
      }
    }
  }

  stop(): void {
    if (this.#handler) {
      this.#pipeline.off(ANY_PACKET, this.#handler);
      this.#handler = null;
    }
    if (!this.stream) return;

    this.stream.close();
    this.stream = null;

    try {
      const header = JSON.parse(
        fs.readFileSync(this.metaFilePath, 'utf8'),
      ) as RecordingHeader;
      header.packetCount = this.packetCount;
      header.duration = Date.now() - this.timestamp;
      fs.writeFileSync(this.metaFilePath, JSON.stringify(header));
    } catch (error) {
      console.error('[proxy] failed to finalize recording header:', error);
    }
  }
}
