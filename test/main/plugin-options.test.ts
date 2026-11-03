import { validatePluginOptionSchema } from '../../src/common/pluginOptions';

const schema = [{
  name: 'General',
  options: [
    { id: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Safe', value: 'safe' }] },
    { id: 'enabled', label: 'Enabled', type: 'switch', defaultValue: true },
    { id: 'count', label: 'Count', type: 'slider', min: 1, max: 5, step: 1, defaultValue: 2 },
    { id: 'targets', label: 'Targets', type: 'list', fields: [{ key: 'name', label: 'Name', type: 'input' }] },
    { id: 'bot', label: 'Bot', type: 'activeBotSelect', botFilter: 'bots', defaultValue: ['steve'] },
    { id: 'clients', label: 'Clients', type: 'activeBotSelect', botFilter: 'minecraft', multiple: true, defaultValue: ['steve', 'alex'] },
  ],
}];

test('accepts typed plugin options', () => {
  expect(validatePluginOptionSchema(schema)).toEqual(schema);
});

test('accepts a JSON-encoded schema for MCP compatibility', () => {
  expect(validatePluginOptionSchema(JSON.stringify(schema))).toEqual(schema);
  expect(validatePluginOptionSchema('[{"name":"General","options":[{"id":"alt","label":"Alt","type":"altSelect"}]}]')).toEqual([
    { name: 'General', options: [{ id: 'alt', label: 'Alt', type: 'altSelect' }] },
  ]);
});

test('reports the invalid option path and a correction hint', () => {
  expect(() => validatePluginOptionSchema([
    { name: 'General', options: [{ id: 'mode', label: 'Mode', type: 'select' }] },
  ])).toThrow(/optionSchema\[0\]\.options\[0\]\.options/);
  try {
    validatePluginOptionSchema('{not json');
  } catch (error: any) {
    expect(error.details).toMatchObject({
      field: 'optionSchema',
      correction: expect.stringContaining('native array'),
    });
  }
});

test.each([
  [[{ name: 'General', options: [{ id: 'mode', label: 'Mode', type: 'select' }] }]],
  [[{ name: 'General', options: [{ id: 'count', label: 'Count', type: 'slider', min: 5, max: 1, step: 1 }] }]],
  [[{ name: 'General', options: [{ id: 'token', label: 'Token', type: 'input', inputType: 'password', defaultValue: 'secret' }] }]],
  [[{ name: 'General', options: [{ id: 'rows', label: 'Rows', type: 'list', fields: [{ key: 'x', label: 'X', type: 'input' }, { key: 'x', label: 'Duplicate', type: 'switch' }] }] }]],
  [[{ name: 'General', options: [{ id: 'bot', label: 'Bot', type: 'activeBotSelect', defaultValue: 'scalar-string' }] }]],
])('rejects invalid option schemas', (value) => {
  expect(() => validatePluginOptionSchema(value)).toThrow();
});

test('resolvePluginOptions respects overrides for controlling dependency options', () => {
  const { resolvePluginOptions } = require('../../src/main/src/workers/bot/plugin/resolvePluginOptions');
  const plugin = {
    pluginId: 'test-plugin',
    config: [
      {
        name: 'General',
        options: [
          { id: 'gamemode', label: 'Gamemode', type: 'gamemodeSelect', defaultValue: 'survival' },
          { id: 'zone', label: 'Zone', type: 'input', valueByFieldId: 'gamemode', defaultValue: 'default-zone' },
        ],
      },
    ],
  };

  (global as any).settings = {
    scripts: {
      'test-plugin': {
        gamemode: 'skyblock',
        zone: {
          skyblock: 'skyblock-hub',
          survival: 'survival-spawn',
        },
      },
    },
  };

  const resolved = resolvePluginOptions(plugin, { gamemode: 'survival' });
  expect(resolved.gamemode).toBe('survival');
  expect(resolved.zone).toBe('survival-spawn');

  // Also verify when dependent appears before dependency in config
  const pluginReversed = {
    pluginId: 'test-plugin',
    config: [
      {
        name: 'General',
        options: [
          { id: 'zone', label: 'Zone', type: 'input', valueByFieldId: 'gamemode', defaultValue: 'default-zone' },
          { id: 'gamemode', label: 'Gamemode', type: 'gamemodeSelect', defaultValue: 'survival' },
        ],
      },
    ],
  };

  const resolvedReversed = resolvePluginOptions(pluginReversed, { gamemode: 'survival' });
  expect(resolvedReversed.gamemode).toBe('survival');
  expect(resolvedReversed.zone).toBe('survival-spawn');

  const partial = resolvePluginOptions(plugin, { zone: { survival: 'override-spawn' } });
  expect(partial.zone).toBe('skyblock-hub');
  expect(resolvePluginOptions(plugin, { gamemode: 'survival', zone: { survival: 'override-spawn' } }).zone).toBe('override-spawn');
});


