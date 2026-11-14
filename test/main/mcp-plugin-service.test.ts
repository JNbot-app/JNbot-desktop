import McpPluginService from '../../src/main/src/functions/mcp/McpPluginService';

const plugin = {
  pluginId: 'plugin1',
  name: 'Plugin',
  description: '',
  scriptType: 'script' as const,
  language: 'js' as const,
  createdAt: 1,
  editedAt: 1,
  public: false,
  config: [
    {
      name: 'General',
      options: [
        { id: 'mode', label: 'Mode', type: 'input' as const },
        {
          id: 'secret',
          label: 'Secret',
          type: 'input' as const,
          inputType: 'password' as const,
        },
      ],
    },
  ],
};

describe('MCP plugin options', () => {
  test('reads and updates ordinary values without exposing secrets', () => {
    let profileSettings: any = {
      scripts: { plugin1: { mode: 'old', secret: 'hidden' } },
    };
    let pluginInfo = plugin;
    const service = new McpPluginService({
      getRuntime: () => ({ profileKey: 'jartex' }),
      settings: {
        getProfileSettings: () => profileSettings,
        replaceProfileSettings: (_key: string, value: unknown) => {
          profileSettings = value;
        },
      },
      macros: {
        readPluginInfo: () => pluginInfo,
        saveInfo: (value: typeof plugin) => {
          pluginInfo = value;
        },
        invalidateLocalCache: jest.fn(),
      },
    } as any);

    expect(service.getOptions(1, 'plugin1').values).toEqual({ mode: 'old' });
    expect(
      service.getOptions(1, 'plugin1').schema[0].options[1].defaultValue,
    ).toBeUndefined();
    expect(service.updateOptions(1, 'plugin1', { mode: 'new' }).values).toEqual(
      { mode: 'new' },
    );
    expect(() =>
      service.updateOptions(1, 'plugin1', { secret: 'changed' }),
    ).toThrow('Sensitive plugin option');

    const schema = service.updateSchema('plugin1', [
      {
        name: 'General',
        options: [{ id: 'enabled', label: 'Enabled', type: 'switch' }],
      },
    ]);
    expect(schema[0].options[0].id).toBe('enabled');
  });

  test('writes presets and creates a missing one from the Default values', () => {
    let profileSettings: any = { scripts: { plugin1: { mode: 'base' } } };
    const service = new McpPluginService({
      getRuntime: () => ({ profileKey: 'jartex' }),
      settings: {
        getProfileSettings: () => profileSettings,
        replaceProfileSettings: (_key: string, value: unknown) => {
          profileSettings = value;
        },
      },
      macros: { readPluginInfo: () => plugin },
    } as any);

    const fast = service.updateOptions(1, 'plugin1', { mode: 'fast' }, false, 'Fast');
    expect(fast.values).toEqual({ mode: 'fast' });
    expect(fast.presets.map(({ name }: { name: string }) => name)).toEqual(['Default', 'Fast']);
    expect(service.getOptions(1, 'plugin1').values).toEqual({ mode: 'base' });
    expect(service.getOptions(1, 'plugin1', 'fast').values).toEqual({ mode: 'fast' });
  });
});

describe('MCP triggers and chains', () => {
  const create = () => {
    let profileSettings: any = { triggers: [], scripts: {} };
    const service = new McpPluginService({
      getRuntime: () => ({ profileKey: 'jartex' }),
      getUiActions: async () => [{ pluginId: 'sell' }],
      settings: {
        getProfileSettings: () => profileSettings,
        replaceProfileSettings: (_key: string, value: unknown) => {
          profileSettings = value;
        },
      },
    } as any);
    return { service, settings: () => profileSettings };
  };

  test('saves, validates and deletes triggers', () => {
    const { service, settings } = create();
    const trigger = service.saveTrigger('jartex', { event: 'death', actions: [{ type: 'notification' }] }) as any;
    expect(settings().triggers).toEqual([trigger]);
    expect(() => service.saveTrigger('jartex', { event: 'death', actions: [] })).toThrow('Add at least one action');
    service.saveTrigger('jartex', { id: trigger.id }, true);
    expect(settings().triggers).toEqual([]);
  });

  test('saves chains with known actions only', async () => {
    const { service, settings } = create();
    const chain = await service.saveChain(1, { name: 'Sell', steps: [{ scriptId: 'sell' }] });
    expect(settings().scripts.chains[chain.id as string].chains[0]).toMatchObject({ id: '1', scriptId: 'sell' });
    expect(settings().scripts[chain.id as string].name).toBe('Sell');
    await expect(service.saveChain(1, { name: 'Bad', steps: [{ scriptId: 'missing' }] })).rejects.toThrow('unknown action');
  });
});
