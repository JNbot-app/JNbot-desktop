import type { MacroInfo } from '../../src/main/src/types';

const runJS = jest.fn();
const stopWorker = jest.fn();
const optionError = jest.fn();
let onActionData: (data: unknown) => void;

jest.mock('worker_threads', () => ({
  ...jest.requireActual('worker_threads'),
  workerData: { id: 'worker' },
}));
jest.mock('../../src/main/src/workers/compiler/jsRuntime', () => ({ runJS }));
jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: {
    stop: stopWorker,
    optionError,
    onMessage: (_event: string, handler: (data: unknown) => void) => {
      onActionData = handler;
      return jest.fn();
    },
  },
}));
jest.mock('../../src/main/src/functions/Script', () => ({
  __esModule: true,
  default: class Script {
    constructor(
      readonly data: any,
      _handler: unknown,
      _runtime: unknown,
      readonly scriptOptions: unknown,
    ) {}
    async run() {
      return this;
    }
  },
}));

import ScriptHandler from '../../src/main/src/functions/ScriptHandler';
import runner from '../../src/main/src/workers/bot/plugin/runner';
import scriptActionRunner from '../../src/main/src/workers/compiler/scriptActions';
import { resolvePluginOptions } from '../../src/main/src/workers/bot/plugin/resolvePluginOptions';
import { startAction, startPlugin } from '../../src/main/src/workers/compiler/scriptApi';

const plugin = {
  name: 'Gifter',
  pluginId: 'gifter',
  language: 'js',
  scriptType: 'script',
  config: [
    {
      name: 'General',
      options: [
        { id: 'receiver', label: 'Receiver', type: 'input', required: true },
        { id: 'amount', label: 'Amount', type: 'input', defaultValue: 1 },
        { id: 'gamemode', label: 'Mode', type: 'gamemodeSelect', defaultValue: 'skyblock' },
        { id: 'warp', label: 'Warp', type: 'input', valueByFieldId: 'gamemode' },
      ],
    },
  ],
} as unknown as MacroInfo;

const stored = (selected?: string) => ({
  receiver: 'default-receiver',
  warp: { skyblock: 'default-warp' },
  ...(selected && { $preset: selected }),
  $presets: {
    second: {
      name: 'Alts 11-20',
      values: { receiver: 'me', amount: 5, warp: { skyblock: 'second-warp' } },
    },
    empty: { name: 'Empty', values: {} },
  },
});

const useStored = (value: Record<string, unknown>) => {
  (global as any).settings = { scripts: { gifter: value } };
};

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).log = jest.fn();
  (global as any).send = jest.fn((event: string, data: any) => {
    if (event === 'SCRIPT_ACTION_DATA')
      onActionData({ ...data, info: plugin, code: { code: 'action' } });
  });
});

describe('resolvePluginOptions', () => {
  test('uses the flat settings when no preset is selected', () => {
    useStored(stored());
    expect(resolvePluginOptions(plugin)).toEqual({
      receiver: 'default-receiver',
      amount: 1,
      gamemode: 'skyblock',
      warp: 'default-warp',
    });
  });

  test('uses the selected preset by default', () => {
    useStored(stored('second'));
    expect(resolvePluginOptions(plugin)).toMatchObject({
      receiver: 'me',
      amount: 5,
      warp: 'second-warp',
    });
  });

  test('a preset override beats the selected preset', () => {
    useStored(stored('empty'));
    expect(resolvePluginOptions(plugin, { $preset: 'second' }).receiver).toBe('me');
    useStored(stored('second'));
    expect(resolvePluginOptions(plugin, { $preset: 'default' }).receiver).toBe(
      'default-receiver',
    );
  });

  test('option overrides still win over the preset', () => {
    useStored(stored());
    expect(
      resolvePluginOptions(plugin, { $preset: 'second', amount: 9 }),
    ).toMatchObject({ receiver: 'me', amount: 9 });
  });

  test('never exposes preset bookkeeping to the plugin', () => {
    useStored(stored('second'));
    const options = resolvePluginOptions(plugin, { $preset: 'second' });
    expect(options).not.toHaveProperty('$preset');
    expect(options).not.toHaveProperty('$presets');
  });

  test('a preset does not fall back to the Default values', () => {
    useStored(stored());
    resolvePluginOptions(plugin, { $preset: 'empty' });
    expect(optionError).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'receiver' }),
      plugin,
    );
    expect(stopWorker).toHaveBeenCalled();
  });

  test('a deleted preset warns and uses Default', () => {
    useStored(stored());
    const options = resolvePluginOptions(plugin, { $preset: 'deleted' });
    expect(options.receiver).toBe('default-receiver');
    expect(global.log).toHaveBeenCalledWith(
      expect.stringContaining('no longer exists'),
      'warning',
    );
  });
});

describe('what a plugin receives', () => {
  const runWith = (optionOverrides?: Record<string, unknown>) =>
    runner({
      components: { code: 'script' },
      macroInfo: plugin,
      devMode: false,
      isMacro: true,
      optionOverrides,
    });

  test('parallel instances each get the settings of their own preset', async () => {
    useStored(stored());
    await runWith({ $preset: 'default' });
    await runWith({ $preset: 'second' });
    expect(runJS.mock.calls.map(([run]) => run.scriptOptions.receiver)).toEqual([
      'default-receiver',
      'me',
    ]);
  });

  test('a script action gets its preset, without the $preset key', async () => {
    useStored(stored());
    await scriptActionRunner({
      id: 'gifter',
      bot: {} as any,
      args: [],
      optionOverrides: { $preset: 'second', amount: 7 },
    });
    expect(runJS.mock.calls[0][0].args[1]).toEqual({
      receiver: 'me',
      amount: 7,
      gamemode: 'skyblock',
      warp: 'second-warp',
    });
  });
});

describe('plugin API', () => {
  const started = () =>
    (global.send as jest.Mock).mock.calls.find(([event]) => event === 'SIMULATE')[1][1];

  test('startPlugin picks a preset by name and keeps overrides on top', () => {
    useStored(stored());
    startPlugin({
      name: 'Gifter',
      pluginId: 'gifter',
      preset: 'alts 11-20',
      optionOverrides: { amount: 9 },
    });
    const { optionOverrides } = started().arguments;
    expect(optionOverrides).toEqual({ $preset: 'second', amount: 9 });
    expect(resolvePluginOptions(plugin, optionOverrides)).toMatchObject({
      receiver: 'me',
      amount: 9,
    });
  });

  test('startPlugin leaves overrides alone without a preset', () => {
    useStored(stored());
    startPlugin({ name: 'Gifter', pluginId: 'gifter', optionOverrides: { amount: 9 } });
    expect(started().arguments.optionOverrides).toEqual({ amount: 9 });
  });

  test('startPlugin refuses a preset that does not exist', () => {
    useStored(stored());
    expect(() =>
      startPlugin({ name: 'Gifter', pluginId: 'gifter', preset: 'nope' }),
    ).toThrow('gifter has no preset "nope"');
  });

  test('startAction hands the action the settings of the picked preset', async () => {
    useStored(stored());
    await startAction({
      actionId: 'gifter',
      bot: {} as any,
      preset: 'second',
      optionOverrides: { amount: 7 },
      args: [],
    });
    expect(runJS.mock.calls[0][0].args[1]).toMatchObject({ receiver: 'me', amount: 7 });
  });

  test('"default" picks Default even when another preset is selected', async () => {
    useStored(stored('second'));
    await startAction({ actionId: 'gifter', bot: {} as any, preset: 'default', args: [] });
    expect(runJS.mock.calls[0][0].args[1].receiver).toBe('default-receiver');
  });
});

describe('ScriptHandler', () => {
  const setup = (scripts: Record<string, unknown>, running: unknown[] = []) => {
    const runtime = {
      profileId: 1,
      profileKey: 'profile',
      activeScripts: {
        getScriptsByScriptId: jest.fn(() => running),
        prepare: jest.fn(),
      },
    };
    const handler = Object.create(ScriptHandler.prototype) as any;
    handler.getRuntime = () => runtime;
    handler.settings = { getProfileSettings: () => ({ scripts }) };
    handler.macros = {
      getMacro: () => ({ status: 'success', info: plugin, code: { code: '' } }),
    };
    handler.scriptIds = { allocate: () => 1 };
    handler.isPluginDisallowed = () => false;
    handler.profileScriptByPluginId = () => undefined;
    return handler;
  };
  const run = (handler: any, optionOverrides?: Record<string, unknown>) =>
    handler.runScript(1, {
      script: 'macro',
      arguments: { macroInfo: plugin, optionOverrides },
    });

  test('pins the selected preset, so changing it later leaves the run alone', async () => {
    const [script] = await run(setup({ gifter: stored('second') }));
    expect(script.data.arguments.optionOverrides).toEqual({ $preset: 'second' });
    expect(script.scriptOptions).toMatchObject({
      presetId: 'second',
      presetName: 'Alts 11-20',
    });
  });

  test('keeps the preset and overrides a run asked for', async () => {
    const [script] = await run(setup({ gifter: stored('second') }), {
      $preset: 'empty',
      amount: 3,
    });
    expect(script.data.arguments.optionOverrides).toEqual({
      $preset: 'empty',
      amount: 3,
    });
    expect(script.scriptOptions.presetName).toBe('Empty');
  });

  test('allows parallel instances up to the limit', async () => {
    const seven = setup({}, Array(7).fill({}));
    expect(await run(seven)).toHaveLength(1);
    const eight = setup({}, Array(8).fill({}));
    expect(await run(eight)).toEqual([]);
  });

  test('a due schedule only replaces the instance on its own preset', () => {
    const stops = { default: jest.fn(), second: jest.fn() };
    const handler = setup({ gifter: stored() }, [
      { stop: stops.default, presetId: 'default' },
      { stop: stops.second, presetId: 'second' },
    ]);
    const options = { $preset: 'second' };
    const profile = {
      scripts: { gifter: stored() },
      reminders: [
        { kind: 'schedule', id: 's', name: 'S', pluginId: 'gifter', nextRunAt: Date.now() - 1, autoStart: true, options },
      ],
    };
    handler.settings = {
      getProfileSettings: () => profile,
      updateProfileSettings: jest.fn(),
    };
    handler.getRuntime().cooldownLastTickAt = Date.now() - 1_000;
    handler.runByPluginId = jest.fn(async () => true);
    handler.tickCooldowns(1);
    expect(stops.second).toHaveBeenCalled();
    expect(stops.default).not.toHaveBeenCalled();
    expect(handler.runByPluginId).toHaveBeenCalledWith(1, 'gifter', options);
  });
});
