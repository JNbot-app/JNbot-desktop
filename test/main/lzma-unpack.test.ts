import { unpackLZMA } from '../../src/main/src/functions/minecraft/launcher/util/lzmaUnpack';
import child_process from 'node:child_process';
import EventEmitter from 'node:events';

jest.mock('node:child_process');
jest.mock('node:fs', () => ({
  createWriteStream: jest.fn(() => {
    const stream = new EventEmitter();
    return stream;
  }),
}));

describe('unpackLZMA', () => {
  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    it('Unix/macOS: rejects when xz command fails to spawn', async () => {
      const mockProc: any = new EventEmitter();
      mockProc.stdout = { pipe: jest.fn() };
      (child_process.spawn as jest.Mock).mockReturnValue(mockProc);

      const promise = unpackLZMA('/path/src.xz', '/path/dest');
      mockProc.emit('error', new Error('ENOENT command not found'));

      await expect(promise).rejects.toThrow(/Failed to spawn xz command/);
    });

    it('Unix/macOS: rejects when xz exits with non-zero code', async () => {
      const mockProc: any = new EventEmitter();
      mockProc.stdout = { pipe: jest.fn() };
      (child_process.spawn as jest.Mock).mockReturnValue(mockProc);

      const promise = unpackLZMA('/path/src.xz', '/path/dest');
      mockProc.emit('exit', 1);

      await expect(promise).rejects.toThrow('xz command exited with code 1');
    });

    it('Unix/macOS: resolves when xz exits with code 0', async () => {
      const mockProc: any = new EventEmitter();
      mockProc.stdout = { pipe: jest.fn() };
      (child_process.spawn as jest.Mock).mockReturnValue(mockProc);

      const promise = unpackLZMA('/path/src.xz', '/path/dest');
      mockProc.emit('exit', 0);

      await expect(promise).resolves.toBeUndefined();
    });
  } else {
    it('Windows: handles 7z decompression failure', async () => {
      (child_process.execFile as unknown as jest.Mock).mockImplementation(
        (cmd, args, opts, cb) => {
          cb(new Error('7z failed'));
        },
      );

      await expect(unpackLZMA('src', 'dest')).rejects.toThrow(/Failed to decompress LZMA/);
    });
  }
});
