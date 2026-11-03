import path from 'node:path';
import { cleanupUserData, freshUserData } from './helpers';
import McpPluginInstaller from '../../src/main/src/functions/mcp/McpPluginInstaller';

afterAll(cleanupUserData);

test('an approved proposal is verified as an installed and listed plugin', async () => {
  const info = new Map<string, any>();
  const code = new Map<string, { code: string }>();
  const ai = new Map<string, any>();
  const macros = {
    create(input: any) {
      const pluginId = 'installedplugin';
      info.set(pluginId, { ...input, pluginId });
      return { status: 'success', pluginId };
    },
    save(pluginId: string, next: { code: string }) {
      code.set(pluginId, next);
    },
    saveInfo(next: any) {
      info.set(next.pluginId, next);
    },
    setAiProvenance(pluginId: string, provenance: any) {
      ai.set(pluginId, provenance);
    },
    readPluginInfo: (pluginId: string) => info.get(pluginId) ?? null,
    readPlugin: (pluginId: string) => code.get(pluginId) ?? null,
    toList: () =>
      [...info.values()].filter(({ pluginId }) => code.has(pluginId)),
    invalidateLocalCache: jest.fn(),
    delete(pluginId: string) {
      info.delete(pluginId);
      code.delete(pluginId);
    },
  };
  const installer = new McpPluginInstaller(
    macros as any,
    path.join(freshUserData(), 'install-proposal-test'),
  );

  const result = await installer.install(
    {
      clientId: 'client',
      name: 'Installed plugin',
      language: 'js',
      scriptType: 'script',
      source: 'module.exports = () => true;',
      optionSchema: [
        {
          name: 'General',
          options: [
            { id: 'enabled', label: 'Enabled', type: 'switch', defaultValue: true },
          ],
        },
      ],
    },
    false,
  );

  expect(result.pluginId).toBe('installedplugin');
  expect(macros.toList()).toHaveLength(1);
  expect(info.get(result.pluginId).ai).toBeUndefined();
  expect(ai.get(result.pluginId)).toMatchObject({
    sourceHash: result.sourceHash,
    firstRunApprovedHash: result.sourceHash,
    clientId: 'client',
  });
  expect(info.get(result.pluginId).config).toEqual([
    {
      name: 'General',
      options: [
        { id: 'enabled', label: 'Enabled', type: 'switch', defaultValue: true },
      ],
    },
  ]);
  expect(
    installer.preview({
      targetPluginId: result.pluginId,
      source: 'module.exports = () => false;',
      optionSchema: [],
    }).optionSchema,
  ).toMatchObject({ changed: true, before: info.get(result.pluginId).config, after: [] });
  expect(macros.invalidateLocalCache).toHaveBeenCalled();
});

test('requires an async action entry point and validates bot APIs', async () => {
  const installer = new McpPluginInstaller(
    {} as any,
    path.join(freshUserData(), 'action-contract-test'),
  );

  const valid = await installer.validate(
    {
      language: 'js',
      scriptType: 'action',
      source: `async function main(bot, settings) {
        const window = await bot.openWindow('/trash', { timeout: 10_000 });
        return Boolean(window && settings.enabled);
      }`,
    },
    false,
  );
  expect(valid).toEqual({ valid: true, errors: [] });

  for (const source of [
    'const value = 1;',
    'function main(bot, settings) { return bot; }',
    'async function main(settings, callback, extra, ignored) { return settings; }',
  ]) {
    await expect(
      installer.validate(
        { language: 'js', scriptType: 'action', source },
        false,
      ),
    ).resolves.toMatchObject({ valid: false });
  }

  const invalid = await installer.validate(
    {
      language: 'js',
      scriptType: 'action',
      source: `async function main(bot, settings, callback) {
        bot.chat('/trash');
        await bot.onceWithTimeout('windowOpen', 5);
        await bot.notARealMethod();
        callback();
      }`,
    },
    false,
  );
  expect(invalid.valid).toBe(false);
  expect(invalid.errors.join('\n')).toContain('bot.openWindow');
  expect(invalid.errors.join('\n')).toContain('bot.notARealMethod');

  const invalidScript = await installer.validate(
    {
      language: 'js',
      scriptType: 'script',
      source: `const { script } = require('jnbot'); script.notARealMethod();`,
    },
    false,
  );
  expect(invalidScript.errors.join('\n')).toContain('script.notARealMethod');
});
