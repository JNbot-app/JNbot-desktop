import path from 'path';
import fs from 'fs';
import { freshUserData, bootElectron, cleanupUserData } from './helpers';
import Console from '../../src/main/src/functions/Console';
import ConsoleHandler from '../../src/main/src/functions/ConsoleHandler';
import { LogStatus } from '../../src/common/CommonEnums';
import snapshotLog from '../../src/main/src/workers/compiler/serializer';
import { logText } from '../../src/common/logText';
import axios from 'axios';

describe('Console and ConsoleHandler', () => {
  let tmpDir: string;
  let mockScriptHandler: any;
  let mockAppSettings: any;
  let consoleHandler: ConsoleHandler;
  let consoleInstance: Console;

  beforeEach(() => {
    tmpDir = freshUserData();
    bootElectron(tmpDir);

    mockAppSettings = {
      logging_dir: path.join(tmpDir, 'logs'),
      script_console_logging: false,
      logs_webhook: '',
    };

    mockScriptHandler = {
      settings: {
        getProfileAppSettings: jest.fn(() => mockAppSettings),
      },
      getRuntime: jest.fn(() => ({
        activeScripts: { toObject: jest.fn(() => ({})) },
      })),
    };

    consoleHandler = new ConsoleHandler(mockScriptHandler, 1, 'jartexnetwork');
    consoleInstance = new Console(() => mockAppSettings);
  });

  afterAll(() => {
    cleanupUserData();
  });

  describe('bounded snapshot text', () => {
    it('uses the same text for downstream destinations', () => {
      expect(logText(snapshotLog([{ value: 1 }]))).toBe('{"value":1}');
    });
  });

  describe('Console circular buffer & log handling', () => {
    it('appends log messages with timestamps and metadata', () => {
      const msgs = consoleInstance.log(
        [['First log message', LogStatus.INFO]],
        'script-1',
        'AutoMiner',
      );

      expect(msgs).toHaveLength(1);
      const [text, level, scriptName, scriptId, time] = msgs[0];
      expect(text).toBe('First log message');
      expect(level).toBe(LogStatus.INFO);
      expect(scriptName).toBe('AutoMiner');
      expect(scriptId).toBe('script-1');
      expect(typeof time).toBe('number');

      const all = consoleInstance.toList();
      expect(all).toHaveLength(1);
    });

    it('get(limit) returns at most limit messages', () => {
      for (let i = 0; i < 30; i++) {
        consoleInstance.log([[`Log ${i}`, LogStatus.INFO]], 'script-1', 'Bot');
      }

      const ten = consoleInstance.get(10);
      expect(ten).toHaveLength(10);
      expect(ten[0][0]).toBe('Log 0');
      expect(ten[9][0]).toBe('Log 9');
    });

    it('clear() without arguments clears all messages', () => {
      consoleInstance.log([['Log 1', LogStatus.INFO]], 's-1', 'BotA');
      consoleInstance.log([['Log 2', LogStatus.INFO]], 's-2', 'BotB');
      expect(consoleInstance.toList()).toHaveLength(2);

      consoleInstance.clear(undefined);
      expect(consoleInstance.toList()).toHaveLength(0);
    });

    it('clear(scriptName) selectively clears only logs for that script', () => {
      consoleInstance.log([['Log A1', LogStatus.INFO]], 's-1', 'ScriptA');
      consoleInstance.log([['Log B1', LogStatus.INFO]], 's-2', 'ScriptB');
      consoleInstance.log([['Log A2', LogStatus.INFO]], 's-1', 'ScriptA');

      consoleInstance.clear('ScriptA');
      const remaining = consoleInstance.toList();
      expect(remaining).toHaveLength(1);
      expect(remaining[0][2]).toBe('ScriptB');
    });
  });

  describe('file logging stream', () => {
    it('writes to daily log file when script_console_logging is enabled', async () => {
      mockAppSettings.script_console_logging = true;
      const fileConsole = new Console(() => mockAppSettings);

      fileConsole.log([['Logged to file', LogStatus.INFO]], 'worker-1', 'WorkerScript');
      fileConsole.log([[snapshotLog([{ items: Array.from({ length: 50_000 }, (_, id) => id) }]), LogStatus.INFO]], 'worker-1', 'WorkerScript');
      await fileConsole.closeStream();

      const files = fs.readdirSync(mockAppSettings.logging_dir);
      expect(files.length).toBeGreaterThan(0);
      const logContent = fs.readFileSync(path.join(mockAppSettings.logging_dir, files[0]), 'utf8');
      expect(logContent).toContain('[worker-1]');
      expect(logContent).toContain('Logged to file');
      expect(logContent).toContain('truncated');
      expect(Buffer.byteLength(logContent)).toBeLessThan(9 * 1024);
    });

    it('drops file entries when pending writes reach the memory cap', async () => {
      mockAppSettings.script_console_logging = true;
      const fileConsole = new Console(() => mockAppSettings);
      fileConsole.log([['first', LogStatus.INFO]], 'worker-1', 'WorkerScript');
      if (!fileConsole.stream) throw new Error('Log stream did not open');
      Object.defineProperty(fileConsole.stream, 'writableLength', {
        configurable: true,
        value: 256 * 1024,
      });
      fileConsole.log([['dropped', LogStatus.INFO]], 'worker-1', 'WorkerScript');
      await fileConsole.closeStream();

      const file = fs.readdirSync(mockAppSettings.logging_dir)[0];
      const content = fs.readFileSync(path.join(mockAppSettings.logging_dir, file), 'utf8');
      expect(content).toContain('first');
      expect(content).toContain('[1 file log entries omitted]');
      expect(content).not.toContain('dropped');
    });
  });

  it('sends bounded snapshot text to the webhook', async () => {
    jest.useFakeTimers();
    const post = jest.spyOn(axios, 'post').mockResolvedValue({} as any);
    try {
      mockAppSettings.logs_webhook = 'https://example.test/webhook';
      const preview = snapshotLog([{ items: Array.from({ length: 50_000 }, (_, id) => id) }]);
      consoleInstance.log([[preview, LogStatus.INFO]], 'worker-1', 'WorkerScript');
      await jest.advanceTimersByTimeAsync(5000);
      expect(post).toHaveBeenCalledTimes(1);
      const payload = post.mock.calls[0][1] as { embeds: { description: string }[] };
      expect(payload.embeds[0].description).toContain('truncated');
      expect(payload.embeds[0].description).toContain('WorkerScript');
      expect(payload.embeds[0].description.length).toBeLessThanOrEqual(4062);
    } finally {
      post.mockRestore();
      jest.useRealTimers();
    }
  });
});
