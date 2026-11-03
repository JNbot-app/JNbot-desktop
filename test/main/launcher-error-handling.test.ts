import path from 'path';
import fs from 'fs/promises';
import {
  safeString,
  readFileTail,
  findNewestFile,
  collectCrashInfo,
  ensureDir,
} from '../../src/main/src/functions/minecraft/launcher/util/errorHandling';
import { freshUserData, cleanupUserData } from './helpers';

describe('launcher errorHandling util', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = freshUserData();
  });

  afterAll(() => {
    cleanupUserData();
  });

  describe('safeString', () => {
    it('returns string as-is', () => {
      expect(safeString('already a string')).toBe('already a string');
    });

    it('formats Error instance as ErrorName: message', () => {
      const err = new TypeError('invalid type provided');
      expect(safeString(err)).toBe('TypeError: invalid type provided');
    });

    it('serializes plain objects to JSON', () => {
      expect(safeString({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
    });

    it('handles circular references without throwing', () => {
      const circular: any = { prop: 'val' };
      circular.self = circular;
      const result = safeString(circular);
      expect(typeof result).toBe('string');
      expect(result).toBe('[object Object]');
    });

    it('handles BigInt, symbols, numbers, and null', () => {
      expect(safeString(BigInt(123456))).toBe('123456');
      expect(safeString(Symbol('test'))).toBe('Symbol(test)');
      expect(safeString(42)).toBe('42');
      expect(safeString(null)).toBe('null');
      expect(safeString(undefined)).toBe('undefined');
    });
  });

  describe('ensureDir', () => {
    it('creates nested directories recursively', async () => {
      const target = path.join(tmpDir, 'deeply', 'nested', 'dir');
      await ensureDir(target);
      const stat = await fs.stat(target);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('readFileTail', () => {
    it('reads the entire file if maxBytes exceeds file size', async () => {
      const file = path.join(tmpDir, 'short.txt');
      await fs.writeFile(file, 'Hello World!', 'utf8');
      const tail = await readFileTail(file, 1024);
      expect(tail).toBe('Hello World!');
    });

    it('reads only the tail end when file exceeds maxBytes', async () => {
      const file = path.join(tmpDir, 'long.txt');
      const content = 'Line 1\nLine 2\nLine 3\nLine 4\nTarget Line';
      await fs.writeFile(file, content, 'utf8');
      const tail = await readFileTail(file, 11);
      expect(tail).toBe('Target Line');
    });

    it('handles empty file (0 bytes)', async () => {
      const file = path.join(tmpDir, 'empty.txt');
      await fs.writeFile(file, '', 'utf8');
      const tail = await readFileTail(file, 100);
      expect(tail).toBe('');
    });
  });

  describe('findNewestFile', () => {
    it('finds newest file matching predicate based on mtime', async () => {
      const dir = path.join(tmpDir, 'reports');
      await fs.mkdir(dir, { recursive: true });

      const file1 = path.join(dir, 'crash_old.txt');
      const file2 = path.join(dir, 'crash_new.txt');
      const fileIgnored = path.join(dir, 'ignored.log');

      await fs.writeFile(file1, 'old crash');
      // Ensure different mtime
      await new Promise((r) => setTimeout(r, 50));
      await fs.writeFile(file2, 'new crash');
      await fs.writeFile(fileIgnored, 'log');

      const newest = await findNewestFile(dir, (name) => name.endsWith('.txt'));
      expect(newest).toBe(file2);
    });

    it('returns null when directory does not exist or has no matches', async () => {
      expect(await findNewestFile(path.join(tmpDir, 'nonexistent'), () => true)).toBeNull();

      const emptyDir = path.join(tmpDir, 'empty');
      await fs.mkdir(emptyDir);
      expect(await findNewestFile(emptyDir, () => true)).toBeNull();
    });
  });

  describe('collectCrashInfo', () => {
    it('collects crash reports, latest.log, and hs_err files', async () => {
      const instancePath = path.join(tmpDir, 'instance');
      await fs.mkdir(path.join(instancePath, 'logs'), { recursive: true });
      await fs.mkdir(path.join(instancePath, 'crash-reports'), { recursive: true });

      const logPath = path.join(instancePath, 'logs', 'latest.log');
      await fs.writeFile(logPath, '[12:00:00] [main/INFO]: Minecraft started');

      const reportPath = path.join(instancePath, 'crash-reports', 'crash-2026-09-10.txt');
      await fs.writeFile(reportPath, 'java.lang.NullPointerException at net.minecraft...');

      const hsErrPath = path.join(instancePath, 'hs_err_pid12345.log');
      await fs.writeFile(hsErrPath, '# A fatal error has been detected by the Java Runtime');

      const crashInfo = await collectCrashInfo({
        bridgeInstanceId: 'inst-1',
        username: 'TestBot',
        version: '1.20.4',
        instancePath,
        code: 1,
        signal: null,
        error: new Error('Process exited with code 1'),
        stdoutTail: 'stdout line',
        stderrTail: 'stderr error',
      });

      expect(crashInfo.bridgeInstanceId).toBe('inst-1');
      expect(crashInfo.username).toBe('TestBot');
      expect(crashInfo.code).toBe(1);
      expect(crashInfo.error).toBe('Error: Process exited with code 1');
      expect(crashInfo.latestLogPath).toBe(logPath);
      expect(crashInfo.latestLogTail).toContain('Minecraft started');
      expect(crashInfo.crashReportPath).toBe(reportPath);
      expect(crashInfo.crashReportTail).toContain('NullPointerException');
      expect(crashInfo.hsErrPath).toBe(hsErrPath);
      expect(crashInfo.hsErrTail).toContain('fatal error has been detected');
    });

    it('handles instances with no logs or crash reports without throwing', async () => {
      const emptyInstance = path.join(tmpDir, 'empty-instance');
      await fs.mkdir(emptyInstance, { recursive: true });

      const crashInfo = await collectCrashInfo({
        bridgeInstanceId: 'inst-2',
        username: 'Bot2',
        version: '1.20.4',
        instancePath: emptyInstance,
      });

      expect(crashInfo.bridgeInstanceId).toBe('inst-2');
      expect(crashInfo.latestLogPath).toBeUndefined();
      expect(crashInfo.crashReportPath).toBeUndefined();
      expect(crashInfo.hsErrPath).toBeUndefined();
    });
  });
});
