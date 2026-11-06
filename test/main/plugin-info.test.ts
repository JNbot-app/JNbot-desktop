jest.mock('../../src/main/src/functions/Script', () => ({
  __esModule: true,
  default: class Script {},
}));

import ScriptHandler from '../../src/main/src/functions/ScriptHandler';

const installed = { pluginId: 'installed', name: 'Installed' };
const remote = { pluginId: 'remote', name: 'Remote' };
const profile = {
  disallowedPlugins: ['blocked'],
  scripts: [
    { id: 's1', pluginId: 'remote', source: { kind: 'url', url: 'https://x' } },
  ],
};
const handler = {
  macros: { toList: () => [installed, { pluginId: 'blocked' }] },
  getRuntime: () => ({ profileKey: 'p' }),
  settings: {
    JNdata: { data: { p: profile } },
    profiles: { scripts: { resolveInfo: async () => ({ info: remote }) } },
    getProfileSettings: () => ({
      scripts: {
        chains: { c1: { id: 'c1', chains: [], name: 'Old' } },
        c1: { name: 'Daily', description: 'Every day' },
      },
    }),
  },
  findProfileScript: ScriptHandler.prototype.findProfileScript,
  isPluginDisallowed: ScriptHandler.prototype.isPluginDisallowed,
  profileScripts: (ScriptHandler.prototype as any).profileScripts,
};
const getInfo = (id: string) =>
  ScriptHandler.prototype.getPluginInfo.call(handler as any, 1, id);

test('resolves installed plugins, profile scripts and chains', async () => {
  await expect(getInfo('installed')).resolves.toBe(installed);
  await expect(getInfo('remote')).resolves.toBe(remote);
  await expect(getInfo('chain:c1')).resolves.toEqual({
    pluginId: 'chain:c1',
    name: 'Daily',
    description: 'Every day',
    scriptType: 'script',
  });
});

test('returns null for unknown and blocked ids', async () => {
  await expect(getInfo('missing')).resolves.toBeNull();
  await expect(getInfo('chain:missing')).resolves.toBeNull();
  await expect(getInfo('blocked')).resolves.toBeNull();
});
