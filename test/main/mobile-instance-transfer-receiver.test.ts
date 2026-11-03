import crypto from 'crypto';
import MobileInstanceTransferReceiver from '../../src/main/src/functions/MobileInstanceTransferReceiver';

describe('MobileInstanceTransferReceiver', () => {
  let receiver: MobileInstanceTransferReceiver;
  const digest = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

  beforeEach(() => {
    receiver = new MobileInstanceTransferReceiver();
  });

  const createValidTransfer = (archiveString: string, chunkSize = 16) => {
    const archive = Buffer.from(archiveString, 'utf8');
    const transferId = 'transfer-12345';
    const chunkCount = Math.ceil(archive.length / chunkSize);
    const manifest = {
      transferId,
      formatVersion: 1,
      byteCount: archive.length,
      chunkCount,
      chunkSize,
      sha256: digest(archive),
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };

    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const slice = archive.subarray(i * chunkSize, (i + 1) * chunkSize);
      chunks.push({
        transferId,
        index: i,
        data: slice.toString('base64'),
        sha256: digest(slice),
      });
    }

    return { manifest, chunks, archive };
  };

  describe('begin manifest validation', () => {
    it('accepts valid manifest and initializes transfer', () => {
      const { manifest } = createValidTransfer('hello world transfer test');
      const result = receiver.begin(manifest);
      expect(result).toEqual({ success: true });
    });

    it('rejects manifest with unsupported formatVersion', () => {
      const { manifest } = createValidTransfer('test');
      expect(() => receiver.begin({ ...manifest, formatVersion: 2 })).toThrow(
        'The desktop sent an invalid instance transfer manifest.',
      );
    });

    it('rejects manifest with non-positive byteCount, chunkCount, or chunkSize', () => {
      const { manifest } = createValidTransfer('test');
      expect(() => receiver.begin({ ...manifest, byteCount: 0 })).toThrow();
      expect(() => receiver.begin({ ...manifest, chunkCount: -1 })).toThrow();
      expect(() => receiver.begin({ ...manifest, chunkSize: 0 })).toThrow();
    });

    it('rejects manifest where chunkCount does not match ceil(byteCount / chunkSize)', () => {
      const { manifest } = createValidTransfer('test', 16);
      expect(() => receiver.begin({ ...manifest, chunkCount: 99 })).toThrow();
    });

    it('rejects manifest with expired expiresAt', () => {
      const { manifest } = createValidTransfer('test');
      expect(() => receiver.begin({ ...manifest, expiresAt: Date.now() - 1000 })).toThrow();
    });

    it('rejects manifest with invalid sha256', () => {
      const { manifest } = createValidTransfer('test');
      expect(() => receiver.begin({ ...manifest, sha256: 'not-a-valid-64-char-hex-hash' })).toThrow();
    });
  });

  describe('append chunk validation & sequencing', () => {
    it('throws if append is called with no transfer in progress', () => {
      expect(() => receiver.append({})).toThrow('No mobile instance transfer is in progress.');
    });

    it('appends chunks in strict sequential order', () => {
      const { manifest, chunks } = createValidTransfer('chunk1chunk2chunk3', 6);
      receiver.begin(manifest);

      expect(receiver.append(chunks[0])).toEqual({ success: true });
      expect(receiver.append(chunks[1])).toEqual({ success: true });
      expect(receiver.append(chunks[2])).toEqual({ success: true });
    });

    it('rejects out-of-order chunks', () => {
      const { manifest, chunks } = createValidTransfer('chunk1chunk2chunk3', 6);
      receiver.begin(manifest);

      // Attempt chunk index 1 before index 0
      expect(() => receiver.append(chunks[1])).toThrow(
        'Received an out-of-order transfer chunk.',
      );
    });

    it('rejects chunk with mismatched transferId', () => {
      const { manifest, chunks } = createValidTransfer('hello');
      receiver.begin(manifest);

      const invalidChunk = { ...chunks[0], transferId: 'wrong-transfer-id' };
      expect(() => receiver.append(invalidChunk)).toThrow(
        'Received an out-of-order transfer chunk.',
      );
    });

    it('rejects chunk with corrupted sha256 or altered data', () => {
      const { manifest, chunks } = createValidTransfer('hello world');
      receiver.begin(manifest);

      const corrupted = {
        ...chunks[0],
        data: Buffer.from('altered content').toString('base64'),
      };
      expect(() => receiver.append(corrupted)).toThrow(
        'A downloaded backup chunk failed verification.',
      );
    });
  });

  describe('finish and verify', () => {
    it('verifies full archive integrity and invokes storage import', async () => {
      const content = 'Full instance profile payload data with json and alts';
      const { manifest, chunks } = createValidTransfer(content, 10);
      receiver.begin(manifest);

      for (const chunk of chunks) {
        receiver.append(chunk);
      }

      const mockStorage = {
        importDirectTransferArchive: jest.fn().mockResolvedValue({ success: true }),
      };

      const result = await receiver.finish(mockStorage as any);
      expect(result).toEqual({ success: true });
      expect(mockStorage.importDirectTransferArchive).toHaveBeenCalledWith(content);

      // Pending state cleared after finish
      expect(() => receiver.append(chunks[0])).toThrow('No mobile instance transfer is in progress.');
    });

    it('throws when finish is called before all chunks are received', async () => {
      const { manifest, chunks } = createValidTransfer('multiple chunks test', 5);
      receiver.begin(manifest);
      receiver.append(chunks[0]); // Only 1 of multiple chunks

      const mockStorage = { importDirectTransferArchive: jest.fn() };
      await expect(receiver.finish(mockStorage as any)).rejects.toThrow(
        'The downloaded backup is incomplete.',
      );
    });

    it('cancel resets the receiver cleanly', () => {
      const { manifest, chunks } = createValidTransfer('cancel test');
      receiver.begin(manifest);
      expect(receiver.cancel()).toEqual({ success: true });
      expect(() => receiver.append(chunks[0])).toThrow('No mobile instance transfer is in progress.');
    });
  });
});
