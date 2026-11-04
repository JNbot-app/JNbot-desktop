import fs from 'fs';
import path from 'path';
import StorageModule from '../../src/main/src/functions/storage/Storage';
import Recordings from '../../src/main/src/functions/storage/Recordings';
import { migrateLegacySettings } from '../../src/main/src/functions/storage/migrateSettings';
import Console from '../../src/main/src/functions/Console';

describe('Storage and Disk Failure Resilience', () => {
  const tmpDir = path.join(__dirname, 'tmp-resilience-tests');

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('StorageModule Resilience', () => {
    interface TestData {
      name: string;
      count: number;
    }
    const defaultData = (): TestData => ({ name: 'default', count: 0 });

    it('recovers with default storage when file is corrupted or invalid JSON', () => {
      const filePath = path.join(tmpDir, 'corrupt.json');
      fs.writeFileSync(filePath, '{ "name": "bad,', 'utf8');

      const storage = new StorageModule<TestData>(filePath, defaultData);
      expect(storage.get()).toEqual({ name: 'default', count: 0 });
      storage.close();
    });

    it('recovers with default storage when file is 0 bytes (e.g. system crash mid-write)', () => {
      const filePath = path.join(tmpDir, 'empty.json');
      fs.writeFileSync(filePath, '', 'utf8');

      const storage = new StorageModule<TestData>(filePath, defaultData);
      expect(storage.get()).toEqual({ name: 'default', count: 0 });
      storage.close();
    });

    it('gracefully handles disk full (ENOSPC) during save() without crashing', () => {
      const filePath = path.join(tmpDir, 'enospc-save.json');
      const storage = new StorageModule<TestData>(filePath, defaultData);

      // Spy on fs.writeSync to simulate disk full ENOSPC
      const writeSyncSpy = jest.spyOn(fs, 'writeSync').mockImplementation(() => {
        const err: any = new Error('ENOSPC: no space left on device');
        err.code = 'ENOSPC';
        throw err;
      });

      storage.set({ name: 'updated', count: 42 });
      // Calling save directly should catch the ENOSPC error
      expect(() => storage.save()).not.toThrow();

      // In-memory storage state should remain preserved
      expect(storage.get()).toEqual({ name: 'updated', count: 42 });

      writeSyncSpy.mockRestore();
      storage.close();
    });

    it('gracefully handles ftruncate failure during save() without crashing', () => {
      const filePath = path.join(tmpDir, 'truncate-fail.json');
      const storage = new StorageModule<TestData>(filePath, defaultData);

      jest.spyOn(fs, 'ftruncateSync').mockImplementation(() => {
        const err: any = new Error('EIO: i/o error');
        err.code = 'EIO';
        throw err;
      });

      storage.set({ name: 'test', count: 1 });
      expect(() => storage.save()).not.toThrow();

      storage.close();
    });

    it('gracefully functions in-memory when file open for writing fails (EACCES / read-only)', () => {
      const filePath = path.join(tmpDir, 'readonly.json');
      fs.writeFileSync(filePath, JSON.stringify({ name: 'initial', count: 5 }), 'utf8');

      const originalOpenSync = fs.openSync;
      jest.spyOn(fs, 'openSync').mockImplementation((p: any, flags: any, ...args: any[]) => {
        if (flags === 'r+') {
          const err: any = new Error('EACCES: permission denied');
          err.code = 'EACCES';
          throw err;
        }
        return originalOpenSync.call(fs, p, flags, ...args);
      });

      const storage = new StorageModule<TestData>(filePath, defaultData);
      expect(storage.get()).toEqual({ name: 'initial', count: 5 });

      // Modifying in-memory state and calling save() should no-op safely without throwing
      expect(() => {
        storage.set({ name: 'new', count: 10 });
        storage.save();
        storage.close();
      }).not.toThrow();

      expect(storage.get()).toEqual({ name: 'new', count: 10 });
    });

    it('falls back to default storage when file cannot even be read (EACCES)', () => {
      const filePath = path.join(tmpDir, 'unreadable.json');
      fs.writeFileSync(filePath, JSON.stringify({ name: 'locked', count: 99 }), 'utf8');

      jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const storage = new StorageModule<TestData>(filePath, defaultData);
      expect(storage.get()).toEqual({ name: 'default', count: 0 });
      storage.close();
    });

    it('reverts to default storage when custom validation fails', () => {
      const filePath = path.join(tmpDir, 'invalid-schema.json');
      fs.writeFileSync(filePath, JSON.stringify({ name: '', count: -99 }), 'utf8');

      const storage = new StorageModule<TestData>(filePath, defaultData, {
        validate: (data) => data.count >= 0,
      });

      expect(storage.get()).toEqual({ name: 'default', count: 0 });
      storage.close();
    });
  });

  describe('Recordings Resilience', () => {
    it('gracefully returns empty array if recordings directory cannot be read', async () => {
      const recordings = new Recordings();
      const fsPromises = require('fs/promises');
      jest.spyOn(fsPromises, 'readdir').mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await recordings.getRecordings();
      expect(result).toEqual([]);
    });

    it('skips corrupted / unparseable recording files without failing the whole list', async () => {
      const recordings = new Recordings();
      const fsPromises = require('fs/promises');

      jest.spyOn(fsPromises, 'readdir').mockResolvedValue(['valid.json', 'corrupt.json', 'empty.json', 'other.txt']);
      jest.spyOn(fsPromises, 'readFile').mockImplementation((p: string) => {
        if (p.includes('valid.json')) {
          return Promise.resolve(JSON.stringify({ id: 'rec-1', name: 'Valid Recording' }));
        }
        if (p.includes('corrupt.json')) {
          return Promise.resolve('{"truncated": ');
        }
        if (p.includes('empty.json')) {
          return Promise.resolve('');
        }
        return Promise.reject(new Error('unreadable'));
      });

      const result = await recordings.getRecordings();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rec-1');
      expect(result[0].name).toBe('Valid Recording');
    });

    it('updateName handles disk full (ENOSPC) during writeFile without throwing', async () => {
      const recordings = new Recordings();
      const fsPromises = require('fs/promises');

      jest.spyOn(recordings, 'getRecordings').mockResolvedValue([
        { id: 'rec-1', name: 'Old Name' } as any,
      ]);
      jest.spyOn(fsPromises, 'writeFile').mockRejectedValue(new Error('ENOSPC: no space left on device'));

      await expect(recordings.updateName('rec-1', 'NewName')).resolves.not.toThrow();
    });

    it('updateRecordingData handles disk full (ENOSPC) during writeFile without throwing', async () => {
      const recordings = new Recordings();
      const fsPromises = require('fs/promises');

      jest.spyOn(fsPromises, 'writeFile').mockRejectedValue(new Error('ENOSPC: no space left on device'));

      await expect(recordings.updateRecordingData('rec-1', 'log content')).resolves.not.toThrow();
    });

    it('getRecordingData returns null when file is missing or unreadable', async () => {
      const recordings = new Recordings();
      const fsPromises = require('fs/promises');

      jest.spyOn(fsPromises, 'readFile').mockRejectedValue(new Error('ENOENT'));

      const data = await recordings.getRecordingData('missing-id');
      expect(data).toBeNull();
    });
  });

  describe('Migration (migrateSettings.ts) Resilience', () => {
    it('returns false and does not crash when legacy settings file contains corrupted JSON', () => {
      const legacyPath = path.join(tmpDir, 'legacy-corrupt.json');
      fs.writeFileSync(legacyPath, '{ bad json', 'utf8');

      const result = migrateLegacySettings({
        legacyPath,
        sharedPath: path.join(tmpDir, 'shared.json'),
        serverDir: path.join(tmpDir, 'serverSettings'),
        appSettingsPath: path.join(tmpDir, 'appSettings.json'),
        defaultJNdata: {} as any,
      });

      expect(result).toBe(false);
    });

    it('returns false and leaves legacy file intact when disk is full (ENOSPC) during migration', () => {
      const legacyPath = path.join(tmpDir, 'legacy-full.json');
      fs.writeFileSync(
        legacyPath,
        JSON.stringify({ alts: [{ username: 'Steve' }], launcherOptions: {} }),
        'utf8',
      );

      // Simulate ENOSPC on writeFileSync
      const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        const err: any = new Error('ENOSPC: no space left on device');
        err.code = 'ENOSPC';
        throw err;
      });

      const result = migrateLegacySettings({
        legacyPath,
        sharedPath: path.join(tmpDir, 'shared.json'),
        serverDir: path.join(tmpDir, 'serverSettings'),
        appSettingsPath: path.join(tmpDir, 'appSettings.json'),
        defaultJNdata: {} as any,
      });

      expect(result).toBe(false);
      // Ensure the legacy file was not renamed to .bak on failure
      expect(fs.existsSync(legacyPath)).toBe(true);

      writeSpy.mockRestore();
    });
  });

  describe('Console Logging Resilience', () => {
    it('openStream handles disk write failure / read-only directory without throwing', () => {
      const mockSettings = {
        script_console_logging: true,
        logging_dir: path.join(tmpDir, 'readonly-logs'),
      };

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {
        const err: any = new Error('EACCES: permission denied');
        err.code = 'EACCES';
        throw err;
      });

      expect(() => {
        const c = new Console(() => mockSettings as any);
        // Writing when stream failed to open should also not throw
        c.writeStream('test message', 'script-1');
        c.closeStream();
      }).not.toThrow();
    });
  });
});
