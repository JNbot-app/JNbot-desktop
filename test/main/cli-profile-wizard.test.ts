import {
  listMarketplaceProfiles,
  installMarketplaceProfile,
  importCloudData,
  getProfileScriptItems,
  getInitialProfileScriptItems,
  resolvePlugin,
  runPlugin,
  actions,
} from '../../src/cli/v2/actions';
import { createProgram } from '../../src/cli/v2/commands';
import type { CliRuntime } from '../../src/cli/v2/types';

describe('CLI Profile Wizard, Marketplace, and Profile Scripts', () => {
  let mockRuntime: CliRuntime;
  let installedServers: string[];
  let currentProfileKey: string;
  let importSharedCalledWith: any = null;
  let runByPluginIdCalledWith: any = null;

  beforeEach(() => {
    installedServers = ['jartexnetwork'];
    currentProfileKey = 'jartexnetwork';
    importSharedCalledWith = null;
    runByPluginIdCalledWith = null;

    // Profile shares on the marketplace; installing one adds the server it describes.
    const shareServers: Record<string, string> = { AAAAAAAAAA: 'pikanetwork', BBBBBBBBBB: 'localhost' };
    const marketEntry = (id: string, title: string, official: boolean) => ({
      id,
      kind: 'profile',
      listing: { title, description: '', details: [{ title: 'Profile', rows: [{ label: 'Gamemodes', value: 'bedwars' }] }] },
      publisher: { name: official ? 'JNbot' : 'Alice', official },
    });

    mockRuntime = {
      handler: {
        clientEvents: {
          shares: {
            marketplace: async () => [marketEntry('BBBBBBBBBB', 'Localhost', false), marketEntry('AAAAAAAAAA', 'PikaNetwork', true)],
            install: async ({ id }: { id: string }) => {
              const server = shareServers[id];
              if (!server) throw new Error('Share not found.');
              if (!installedServers.includes(server)) installedServers.push(server);
              return { localRef: server };
            },
          },
        },
        macros: {
          toList: () => [
            { pluginId: 'custom_macro', name: 'Custom Macro', scriptType: 'action', language: 'ts' },
          ],
        },
        settings: {
          JNdata: {
            version: 1,
            serverList: ['jartexnetwork', 'pikanetwork', 'localhost'],
            data: {
              jartexnetwork: {
                name: 'JartexNetwork',
                defaultIp: 'top.jartex.fun',
                scripts: [
                  {
                    id: 's_autosell',
                    pluginId: 'jartex_auto_sell',
                    source: { kind: 'url', url: 'https://example.com/autosell.jnp', infoPath: '' },
                  },
                ],
              },
              pikanetwork: { name: 'PikaNetwork', defaultIp: 'top.pika.host' },
              localhost: { name: 'Localhost', defaultIp: '127.0.0.1' },
            },
            servers: {
              jartexnetwork: { skyblock: { ranks: {}, gkits: {} } },
              pikanetwork: { bedwars: { ranks: {}, gkits: {} } },
              localhost: {},
            },
          },
          profiles: {
            list: [],
            scripts: {
              resolveInfo: async (script: any) => ({
                info: { name: 'Jartex Auto Sell', pluginId: script.pluginId, scriptType: 'Profile script' },
              }),
            },
          },
          getAvailableProfiles: () =>
            installedServers.map((server) => ({
              server,
              data: { name: server },
              gamemodes: {},
            })),
          getProfileSettings: () => ({ scripts: {} }),
          updateProfileSettings: () => undefined,
        },
        selectBootstrapProfile: (id: string) => {
          if (!installedServers.includes(id)) return null;
          currentProfileKey = id;
          return { profileKey: id, profileId: 1 } as any;
        },
        getBootstrapRuntime: () => ({
          profileKey: currentProfileKey,
          profileId: 1,
        }) as any,
        getCloudStorage: () => ({
          importSharedFromUser: async (options: any) => {
            importSharedCalledWith = options;
            installedServers.push('jartexnetwork');
          },
        }) as any,
        runByPluginId: async (profileId: number, pluginId: string) => {
          runByPluginIdCalledWith = { profileId, pluginId };
          return true;
        },
      } as any,
      close: async () => undefined,
    };
  });

  it('lists marketplace profiles, official first, with installation status', async () => {
    const res = await listMarketplaceProfiles(mockRuntime);
    expect(res.ok).toBe(true);
    expect(res.data.map((row: any) => row.id)).toEqual(['AAAAAAAAAA', 'BBBBBBBBBB']);
    expect(res.data[0]).toMatchObject({ name: 'PikaNetwork', official: true, summary: 'bedwars', installed: false });
  });

  it('installs and activates a marketplace profile', async () => {
    const installRes = await installMarketplaceProfile(mockRuntime, 'AAAAAAAAAA');
    expect(installRes.ok).toBe(true);
    expect(installRes.data).toEqual({ id: 'pikanetwork', name: 'PikaNetwork' });
    expect(currentProfileKey).toBe('pikanetwork');
    expect(installedServers).toContain('pikanetwork');
  });

  it('fails to install an unknown marketplace profile', async () => {
    const installRes = await installMarketplaceProfile(mockRuntime, 'ZZZZZZZZZZ');
    expect(installRes.ok).toBe(false);
    expect(installRes.code).toBe(2);
  });

  it('validates required fields for cloud import', async () => {
    const resEmpty = await importCloudData(mockRuntime, '', '');
    expect(resEmpty.ok).toBe(false);
    expect(resEmpty.error).toContain('required');
  });

  it('imports cloud data and reconciles active profile', async () => {
    const res = await importCloudData(mockRuntime, 'user_123', 'share_abc');
    expect(res.ok).toBe(true);
    expect(importSharedCalledWith).toEqual({ userId: 'user_123', shareKey: 'share_abc' });
    expect(currentProfileKey).toBe('jartexnetwork');
  });

  it('returns initial and resolved profile scripts for active profile', async () => {
    const initial = getInitialProfileScriptItems(mockRuntime);
    expect(initial).toHaveLength(1);
    expect(initial[0].id).toBe('jartex_auto_sell');

    const resolved = await getProfileScriptItems(mockRuntime);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual({
      id: 'jartex_auto_sell',
      name: 'Jartex Auto Sell',
      type: 'script',
      detail: 'Profile script',
      author: undefined,
      config: undefined,
    });
  });

  it('resolves and runs profile scripts by pluginId', async () => {
    const resolved = await resolvePlugin(mockRuntime, 'jartex_auto_sell');
    expect(resolved.ok).toBe(true);
    expect(resolved.data.name).toBe('Jartex Auto Sell');

    const runRes = await runPlugin(mockRuntime, 'jartex_auto_sell');
    expect(runRes.ok).toBe(true);
    expect(runByPluginIdCalledWith).toEqual({
      profileId: 1,
      pluginId: 'jartex_auto_sell',
    });
  });

  it('includes profile scripts in script.list and library plugins in plugin.list actions', async () => {
    const scriptsRes = await actions.scripts.execute(mockRuntime);
    expect(scriptsRes.ok).toBe(true);
    const profileScript = scriptsRes.data.find((s: any) => s.id === 'jartex_auto_sell');
    expect(profileScript).toBeTruthy();
    expect(profileScript.name).toBe('Jartex Auto Sell');

    const pluginsRes = await actions.plugins.execute(mockRuntime);
    expect(pluginsRes.ok).toBe(true);
    const hasMacroPlugin = pluginsRes.data.some((p: any) => p.id === 'custom_macro');
    expect(hasMacroPlugin).toBe(true);
  });

  it('supports profile marketplace and install in Commander program', async () => {
    let result: any = null;
    let outputText = '';
    const program = createProgram({
      runtime: mockRuntime,
      onResult: (r) => { result = r; },
      onOutput: (t) => { outputText += t; },
    });
    program.exitOverride();

    await program.parseAsync(['node', 'jnbot', 'profile', 'marketplace']);
    expect(result?.ok).toBe(true);
    expect(Array.isArray(result?.data)).toBe(true);

    await program.parseAsync(['node', 'jnbot', 'profile', 'install', 'BBBBBBBBBB']);
    expect(result?.ok).toBe(true);
    expect(currentProfileKey).toBe('localhost');
  });
});
