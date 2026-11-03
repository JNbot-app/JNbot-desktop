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
});
