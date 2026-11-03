import { runJS } from '../../src/main/src/workers/compiler/jsRuntime';
import type { MacroInfo } from '../../src/main/src/types';
import esbuild from 'esbuild';

jest.mock('worker_threads', () => ({
  ...jest.requireActual('worker_threads'),
  workerData: { script: 'profile-action-test' },
}));

jest.mock('../../src/main/src/workers/compiler/scriptRuntime', () => ({
  buildScriptRuntime: () => ({ script: { settings: {} }, require }),
}));
jest.mock('../../src/main/src/workers/bot/join', () => jest.fn());

const info = {
  name: 'Profile action',
  pluginId: 'profile-action',
  scriptType: 'action',
  language: 'js',
  description: '',
  editedAt: null,
  createdAt: 0,
  public: false,
} satisfies MacroInfo;

beforeEach(() => {
  global.appSettings = {} as typeof global.appSettings;
  global.log = jest.fn() as typeof global.log;
  global.logCall = jest.fn() as typeof global.logCall;
});

test('profile action runs in the action runtime with settings', async () => {
  const bot: { message?: string } = {};
  await runJS({
    code: 'function main(bot, settings) { bot.message = settings.message; }',
    scriptInfo: info,
    args: [bot, { message: 'hello' }, []],
    runAsAction: true,
    allowExportedMain: true,
  });
  expect(bot.message).toBe('hello');
});

test('legacy CommonJS entry point runs', async () => {
  const bot: { loaded?: boolean } = {};
  await runJS({
    code: 'module.exports = function inject(bot) { bot.loaded = true; };',
    scriptInfo: info,
    args: [bot, {}, []],
    runAsAction: true,
    allowExportedMain: true,
    useWorkerRealm: true,
  });
  expect(bot.loaded).toBe(true);
});

test('legacy TypeScript default export runs', async () => {
  const bot: { loaded?: boolean } = {};
  const code = esbuild.transformSync(
    'export default function inject(bot: { loaded?: boolean }) { bot.loaded = true; }',
    { loader: 'ts', format: 'cjs' },
  ).code;
  await runJS({
    code,
    scriptInfo: { ...info, language: 'ts' },
    args: [bot, {}, []],
    runAsAction: true,
    allowExportedMain: true,
    useWorkerRealm: true,
  });
  expect(bot.loaded).toBe(true);
});

test('profile action can use worker string helpers', async () => {
  const previous = Object.getOwnPropertyDescriptor(String.prototype, 'toAlpha');
  Object.defineProperty(String.prototype, 'toAlpha', {
    configurable: true,
    value() {
      return this.replace(/ᴍ/g, 'm');
    },
  });
  try {
    const bot: { gamemode?: string } = {};
    await runJS({
      code:
        'function main(bot) { bot.gamemode = "ᴍ".replace(/x/g, "").toAlpha(); }',
      scriptInfo: info,
      args: [bot, {}, []],
      runAsAction: true,
      allowExportedMain: true,
      useWorkerRealm: true,
    });
    expect(bot.gamemode).toBe('m');
  } finally {
    if (previous) Object.defineProperty(String.prototype, 'toAlpha', previous);
    else delete (String.prototype as { toAlpha?: () => string }).toAlpha;
  }
});

test('action failures reject instead of leaving a pending run', async () => {
  await expect(runJS({
    code: 'async function main() { throw new Error("failed"); }',
    scriptInfo: info,
    runAsAction: true,
  })).rejects.toThrow('failed');
});

test('one console call emits one bounded argument list', async () => {
  await runJS({
    code: 'console.log(...Array.from({ length: 100 }, (_, index) => index))',
    scriptInfo: info,
  });
  expect(global.logCall).toHaveBeenCalledTimes(1);
  expect((global.logCall as jest.Mock).mock.lastCall?.[0]).toHaveLength(100);
});

test('script console passes large objects to the bounded worker log path', async () => {
  await runJS({
    code: 'console.log({ items: Array.from({ length: 50_000 }, (_, index) => index) })',
    scriptInfo: info,
  });
  expect(global.logCall).toHaveBeenCalledTimes(1);
});
