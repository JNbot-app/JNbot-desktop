import crypto from 'crypto';
import type { InstanceTransferChunk, InstanceTransferManifest } from '../../../common/mobileClientContract';
import type CloudStorage from './storage/CloudStorage';

type PendingTransfer = {
  manifest: InstanceTransferManifest;
  chunks: Buffer[];
  receivedBytes: number;
};

/**
 * Mobile's embedded Node runtime owns direct-transfer decoding and integrity
 * checks. React Native only relays authenticated WebRTC messages to it.
 */
export default class MobileInstanceTransferReceiver {
  private pending: PendingTransfer | null = null;

  begin(input: unknown): { success: true } {
    const manifest = readManifest(input);
    this.pending = { manifest, chunks: [], receivedBytes: 0 };
    return { success: true };
  }

  append(input: unknown): { success: true } {
    const pending = this.requirePending();
    const chunk = readChunk(input);
    const expectedIndex = pending.chunks.length;
    if (chunk.transferId !== pending.manifest.transferId || chunk.index !== expectedIndex)
      throw new Error('Received an out-of-order transfer chunk.');
    const bytes = Buffer.from(chunk.data, 'base64');
    const expectedBytes = Math.min(
      pending.manifest.chunkSize,
      pending.manifest.byteCount - pending.receivedBytes,
    );
    if (bytes.length !== expectedBytes || digest(bytes) !== chunk.sha256)
      throw new Error('A downloaded backup chunk failed verification.');
    pending.chunks.push(bytes);
    pending.receivedBytes += bytes.length;
    return { success: true };
  }

  async finish(storage: CloudStorage): Promise<{ success: true }> {
    const pending = this.requirePending();
    try {
      if (
        pending.chunks.length !== pending.manifest.chunkCount ||
        pending.receivedBytes !== pending.manifest.byteCount
      ) throw new Error('The downloaded backup is incomplete.');
      const archive = Buffer.concat(pending.chunks, pending.receivedBytes);
      if (digest(archive) !== pending.manifest.sha256)
        throw new Error('The downloaded backup failed verification.');
      await storage.importDirectTransferArchive(archive.toString('utf8'));
      return { success: true };
    } finally {
      this.pending = null;
    }
  }

  cancel(): { success: true } {
    this.pending = null;
    return { success: true };
  }

  private requirePending(): PendingTransfer {
    if (!this.pending) throw new Error('No mobile instance transfer is in progress.');
    return this.pending;
  }
}

function readManifest(input: unknown): InstanceTransferManifest {
  if (!isRecord(input)) throw new Error('The desktop sent an invalid instance transfer manifest.');
  const value = input;
  if (
    !value || typeof value.transferId !== 'string' || value.formatVersion !== 1 ||
    !isPositiveInteger(value.byteCount) || !isPositiveInteger(value.chunkCount) ||
    !isPositiveInteger(value.chunkSize) || !isDigest(value.sha256) ||
    !isFiniteNumber(value.createdAt) || !isFiniteNumber(value.expiresAt) ||
    value.expiresAt <= Date.now() ||
    Math.ceil(value.byteCount / value.chunkSize) !== value.chunkCount
  ) throw new Error('The desktop sent an invalid instance transfer manifest.');
  return {
    transferId: value.transferId,
    formatVersion: 1,
    byteCount: value.byteCount,
    chunkCount: value.chunkCount,
    chunkSize: value.chunkSize,
    sha256: value.sha256,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  };
}

function readChunk(input: unknown): InstanceTransferChunk {
  if (!isRecord(input)) throw new Error('The desktop sent an invalid instance transfer chunk.');
  const value = input;
  if (
    !value || typeof value.transferId !== 'string' || !isNonNegativeInteger(value.index) ||
    typeof value.data !== 'string' || !isDigest(value.sha256)
  ) throw new Error('The desktop sent an invalid instance transfer chunk.');
  return { transferId: value.transferId, index: value.index, data: value.data, sha256: value.sha256 };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function digest(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
