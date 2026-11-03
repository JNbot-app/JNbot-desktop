import crypto from 'crypto';
import { getPlatform } from '../platform';
import type { Address } from '../../../common/messaging';
import type { InstanceTransferChunk, InstanceTransferManifest, InstanceTransferRequestResult } from '../../../common/mobileClientContract';
import type Settings_ from './Settings';
import type CloudStorage from './storage/CloudStorage';

const CHUNK_SIZE = 64 * 1024;
const APPROVAL_TIMEOUT_MS = 2 * 60_000;
const TRANSFER_TIMEOUT_MS = 5 * 60_000;

type Transfer = { requestId: string; origin: Address; deviceId: string; archive: Buffer; manifest: InstanceTransferManifest; expiry: ReturnType<typeof setTimeout> };

export default class InstanceTransferService {
  private readonly transfers = new Map<string, Transfer>();
  private readonly pendingDevices = new Map<Address, string>();

  constructor(private readonly settings: Settings_) {}

  async request(storage: CloudStorage, origin: Address, deviceId: string, requestId: unknown): Promise<InstanceTransferRequestResult> {
    if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 128)
      throw new Error('A valid transfer request ID is required.');
    const existing = [...this.transfers.values()].find(
      (transfer) => transfer.deviceId === deviceId && transfer.requestId === requestId,
    );
    if (existing) {
      // A WebRTC renegotiation gives the same authenticated device a new
      // messenger address. Preserve the one-time request while rebinding it.
      existing.origin = origin;
      return { status: 'approved', manifest: existing.manifest };
    }
    if ([...this.pendingDevices.values()].includes(deviceId) || [...this.transfers.values()].some((transfer) => transfer.deviceId === deviceId))
      throw new Error('An instance transfer is already pending for this device.');
    const name = this.settings.shared.devices.find((device) => device.id === deviceId)?.name ?? 'Unknown device';
    this.pendingDevices.set(origin, deviceId);
    try {
      const approved = await this.prompt(name);
      if (!approved) return { status: 'denied' };
      const archive = await storage.createDirectTransferArchive();
      const transferId = crypto.randomBytes(16).toString('hex');
      const manifest: InstanceTransferManifest = {
        transferId, formatVersion: 1, byteCount: archive.length,
        chunkCount: Math.ceil(archive.length / CHUNK_SIZE), chunkSize: CHUNK_SIZE,
        sha256: digest(archive), createdAt: Date.now(), expiresAt: Date.now() + TRANSFER_TIMEOUT_MS,
      };
      const expiry = setTimeout(() => this.remove(transferId), TRANSFER_TIMEOUT_MS);
      this.transfers.set(transferId, { requestId, origin, deviceId, archive, manifest, expiry });
      return { status: 'approved', manifest };
    } finally {
      this.pendingDevices.delete(origin);
    }
  }

  read(origin: Address, transferId: unknown, index: unknown): InstanceTransferChunk {
    const transfer = this.get(origin, transferId);
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= transfer.manifest.chunkCount)
      throw new Error('Invalid transfer chunk index.');
    const start = (index as number) * CHUNK_SIZE;
    const data = transfer.archive.subarray(start, start + CHUNK_SIZE);
    return { transferId: transfer.manifest.transferId, index: index as number, data: data.toString('base64'), sha256: digest(data) };
  }

  complete(origin: Address, transferId: unknown): { success: true } { this.get(origin, transferId); this.remove(transferId as string); return { success: true }; }
  cancel(origin: Address, transferId: unknown): { success: true } { this.get(origin, transferId); this.remove(transferId as string); return { success: true }; }
  cancelOrigin(origin: Address): void {
    for (const [transferId, transfer] of this.transfers)
      if (transfer.origin === origin) this.remove(transferId);
    this.pendingDevices.delete(origin);
  }

  private get(origin: Address, transferId: unknown): Transfer {
    if (typeof transferId !== 'string') throw new Error('Invalid transfer ID.');
    const transfer = this.transfers.get(transferId);
    if (!transfer || transfer.origin !== origin) throw new Error('Transfer is unavailable.');
    return transfer;
  }
  private remove(transferId: string) { const transfer = this.transfers.get(transferId); if (!transfer) return; clearTimeout(transfer.expiry); this.transfers.delete(transferId); }
  private async prompt(name: string): Promise<boolean> {
    const result = await Promise.race([
      getPlatform().confirmPrompt({
        title: 'Approve instance transfer?',
        message: `${name} requested a one-time instance transfer. Profiles, account credentials, settings, statistics, plugins, and plugin secrets will be copied.`, 
        confirmLabel: 'Approve transfer',
        cancelLabel: 'Deny',
        type: 'warning',
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), APPROVAL_TIMEOUT_MS)),
    ]);
    return result === true;
  }
}

function digest(value: Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }
