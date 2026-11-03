import InstanceTransferService from '../../src/main/src/functions/InstanceTransferService';
import { getPlatform } from '../../src/main/src/platform';
import type { Address } from '../../src/common/messaging';

jest.mock('../../src/main/src/platform', () => ({
  getPlatform: jest.fn(),
}));

describe('InstanceTransferService', () => {
  let service: InstanceTransferService;
  let mockSettings: any;
  let mockStorage: any;
  let mockPlatform: any;

  const origin1: Address = { type: 'client', clientId: 'client-1' } as any;
  const origin2: Address = { type: 'client', clientId: 'client-2' } as any;

  beforeEach(() => {
    mockPlatform = {
      confirmPrompt: jest.fn(),
    };
    (getPlatform as jest.Mock).mockReturnValue(mockPlatform);

    mockSettings = {
      shared: {
        devices: [
          { id: 'device-1', name: 'My Android' },
        ],
      },
    };

    mockStorage = {
      createDirectTransferArchive: jest.fn(async () => Buffer.from('archive content payload for backup', 'utf8')),
    };

    service = new InstanceTransferService(mockSettings);
  });

  describe('request', () => {
    it('rejects invalid request IDs', async () => {
      await expect(service.request(mockStorage, origin1, 'device-1', '')).rejects.toThrow(
        'A valid transfer request ID is required.',
      );
      await expect(service.request(mockStorage, origin1, 'device-1', 'a'.repeat(129))).rejects.toThrow(
        'A valid transfer request ID is required.',
      );
      await expect(service.request(mockStorage, origin1, 'device-1', 123 as any)).rejects.toThrow(
        'A valid transfer request ID is required.',
      );
    });

    it('returns status: denied if user denies confirm prompt', async () => {
      mockPlatform.confirmPrompt.mockResolvedValue(false);

      const result = await service.request(mockStorage, origin1, 'device-1', 'req-1');
      expect(result).toEqual({ status: 'denied' });
      expect(mockStorage.createDirectTransferArchive).not.toHaveBeenCalled();
    });

    it('creates transfer manifest and returns status: approved when user confirms', async () => {
      mockPlatform.confirmPrompt.mockResolvedValue(true);

      const result = await service.request(mockStorage, origin1, 'device-1', 'req-1');
      expect(result.status).toBe('approved');
      if (result.status === 'approved') {
        expect(result.manifest.formatVersion).toBe(1);
        expect(result.manifest.byteCount).toBe(Buffer.from('archive content payload for backup').length);
        expect(result.manifest.chunkCount).toBe(1);
        expect(result.manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('rebinds origin when same device and requestId reconnects', async () => {
      mockPlatform.confirmPrompt.mockResolvedValue(true);

      const first = await service.request(mockStorage, origin1, 'device-1', 'req-rebind');
      expect(first.status).toBe('approved');

      // WebRTC renegotiation with new origin
      const second = await service.request(mockStorage, origin2, 'device-1', 'req-rebind');
      expect(second.status).toBe('approved');
      if (first.status === 'approved' && second.status === 'approved') {
        expect(second.manifest.transferId).toBe(first.manifest.transferId);
      }
    });

    it('rejects concurrent transfer for the same device with different requestId', async () => {
      mockPlatform.confirmPrompt.mockResolvedValue(true);

      await service.request(mockStorage, origin1, 'device-1', 'req-first');
      await expect(service.request(mockStorage, origin1, 'device-1', 'req-second')).rejects.toThrow(
        'An instance transfer is already pending for this device.',
      );
    });
  });

  describe('read, complete, and cancel', () => {
    let transferId: string;

    beforeEach(async () => {
      mockPlatform.confirmPrompt.mockResolvedValue(true);
      const res = await service.request(mockStorage, origin1, 'device-1', 'req-read');
      if (res.status === 'approved') {
        transferId = res.manifest.transferId;
      }
    });

    it('reads chunks by index verifying base64 data and sha256', () => {
      const chunk = service.read(origin1, transferId, 0);
      expect(chunk.transferId).toBe(transferId);
      expect(chunk.index).toBe(0);
      expect(Buffer.from(chunk.data, 'base64').toString('utf8')).toBe(
        'archive content payload for backup',
      );
      expect(chunk.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('throws when reading with invalid index', () => {
      expect(() => service.read(origin1, transferId, -1)).toThrow('Invalid transfer chunk index.');
      expect(() => service.read(origin1, transferId, 1)).toThrow('Invalid transfer chunk index.');
      expect(() => service.read(origin1, transferId, '0' as any)).toThrow(
        'Invalid transfer chunk index.',
      );
    });

    it('throws when reading with mismatched origin or nonexistent transferId', () => {
      expect(() => service.read(origin2, transferId, 0)).toThrow('Transfer is unavailable.');
      expect(() => service.read(origin1, 'invalid-id', 0)).toThrow('Transfer is unavailable.');
    });

    it('complete removes transfer cleanly', () => {
      expect(service.complete(origin1, transferId)).toEqual({ success: true });
      expect(() => service.read(origin1, transferId, 0)).toThrow('Transfer is unavailable.');
    });

    it('cancel removes transfer cleanly', () => {
      expect(service.cancel(origin1, transferId)).toEqual({ success: true });
      expect(() => service.read(origin1, transferId, 0)).toThrow('Transfer is unavailable.');
    });

    it('cancelOrigin clears all transfers for that address', () => {
      service.cancelOrigin(origin1);
      expect(() => service.read(origin1, transferId, 0)).toThrow('Transfer is unavailable.');
    });
  });
});
