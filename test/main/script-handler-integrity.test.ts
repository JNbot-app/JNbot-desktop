jest.mock('../../src/main/src/functions/Script', () => ({
  __esModule: true,
  default: class Script {
    constructor(private readonly data: unknown) {}

    async run() {
      return this.data;
    }
  },
}));

import ScriptHandler from '../../src/main/src/functions/ScriptHandler';

test('runs a profile script when integrity verification fails', async () => {
  const profileScript = {
    id: 'profile-script',
    pluginId: 'profile-plugin',
    signature: { signature: 'invalid' },
  } as any;
  const resolved = {
    info: {
      name: 'Profile plugin',
      pluginId: 'profile-plugin',
      language: 'js',
    },
    code: { code: 'console.log("runs")' },
    checksumOk: false,
    signatureOk: false,
  };
  const runtime = {
    profileId: 1,
    activeScripts: {
      getScriptsByScriptId: jest.fn(() => []),
      prepare: jest.fn(),
    },
  };
  const handler = Object.create(ScriptHandler.prototype) as any;
  handler.enableProfile = jest.fn(() => runtime);
  handler.settings = {
    profiles: { scripts: { resolve: jest.fn(async () => resolved) } },
  };
  handler.macros = { toList: jest.fn(() => []) };
  handler.scriptIds = { allocate: jest.fn(() => 12) };
  handler.botIdArray = new Uint16Array(1);
  handler.isPluginDisallowed = jest.fn(() => false);
  handler.profileScriptByPluginId = jest.fn(() => profileScript);

  const result = await handler.runScript({
    script: 'macro',
    arguments: {
      macroInfo: { pluginId: 'profile-plugin' },
    },
  });

  expect(result).toHaveLength(1);
  expect(runtime.activeScripts.prepare).toHaveBeenCalledTimes(1);
  expect(handler.settings.profiles.scripts.resolve).toHaveBeenCalledWith(
    profileScript,
    true,
  );
});
