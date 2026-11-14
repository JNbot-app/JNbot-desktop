jest.mock('../../src/main/src/functions/actions/dialog', () => jest.fn(
  () => new Promise<string>(() => undefined),
));

import fs from 'fs';
import os from 'os';
import path from 'path';
import Macros from '../../src/main/src/functions/Macros';

describe('backup plugin restore', () => {
  let directory: string;
  let macros: Macros;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-backup-plugins-'));
    (global as { send: jest.Mock }).send = jest.fn();
    macros = new Macros({} as never);
    macros.macros_path = directory;
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('restores usable plugins without waiting for a desktop trust dialog', async () => {
    const corruptedPlugin = JSON.stringify({
      info: macros.defaultPluginInfo({
        pluginId: 'corrupted-plugin',
        name: 'Corrupted plugin',
        language: 'js',
        scriptType: 'script',
      }),
      code: { code: 'module.exports = false;' },
      signature: {
        algorithm: 'ed25519',
        publicKey: 'not-a-public-key',
        publisherName: 'Invalid',
        signedAt: 'not-a-date',
        value: 'not-a-signature',
      },
    });
    const plugin = JSON.stringify({
      info: macros.defaultPluginInfo({
        pluginId: 'restored-plugin',
        name: 'Restored plugin',
        language: 'js',
        scriptType: 'script',
      }),
      code: { code: 'module.exports = true;' },
    });

    await expect(
      Promise.race([
        macros.fromJSON(JSON.stringify(['not-json', corruptedPlugin, plugin]), 'restore'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('restore timed out')), 100)),
      ]),
    ).resolves.toBeUndefined();
    expect(macros.findPlugin('corrupted-plugin')).toBeNull();
    expect(macros.findPlugin('restored-plugin')?.name).toBe('Restored plugin');
  });

  it('exports unsigned plugins for backup without requiring a publisher identity', () => {
    const unsignedInfo = macros.defaultPluginInfo({
      pluginId: 'script-runner',
      name: 'Script Runner',
      language: 'js',
      scriptType: 'script',
    });
    fs.writeFileSync(
      path.join(directory, '_script-runner.json'),
      JSON.stringify(unsignedInfo),
    );
    fs.writeFileSync(
      path.join(directory, 'script-runner.js'),
      'module.exports = () => true;',
    );

    const exported = macros.toJSON({ allowUnsigned: true });
    const parsed = JSON.parse(exported);
    expect(parsed).toHaveLength(1);

    const bundle = JSON.parse(parsed[0]);
    expect(bundle.info.name).toBe('Script Runner');
    expect(bundle.code).toEqual({ code: 'module.exports = () => true;' });
    expect(bundle.signature).toBeUndefined();
  });

  it('defaults fromJSON to restore policy without requiring explicit arguments', async () => {
    const plugin = JSON.stringify({
      info: macros.defaultPluginInfo({
        pluginId: 'default-restored-plugin',
        name: 'Default Restored',
        language: 'js',
        scriptType: 'script',
      }),
      code: { code: 'module.exports = true;' },
    });

    await expect(
      Promise.race([
        macros.fromJSON(JSON.stringify([plugin])),
        new Promise((_, reject) => setTimeout(() => reject(new Error('restore timed out')), 100)),
      ]),
    ).resolves.toBeUndefined();
    expect(macros.findPlugin('default-restored-plugin')?.name).toBe('Default Restored');
  });

  it('restores plugins via CloudStorage restorePayload without desktop trust dialog', async () => {
    const plugin = JSON.stringify({
      info: macros.defaultPluginInfo({
        pluginId: 'cloud-restored-plugin',
        name: 'Cloud Restored',
        language: 'js',
        scriptType: 'script',
      }),
      code: { code: 'module.exports = true;' },
    });

    const mockSettings = { fromJSON: jest.fn() };
    const CloudStorage = (await import('../../src/main/src/functions/storage/CloudStorage')).default;
    const storage = new CloudStorage({ settings: mockSettings, macros } as any);

    await expect(
      Promise.race([
        (storage as any).restorePayload({
          version: 4,
          uid: 'test-user',
          createdAt: Date.now(),
          settingsJson: '{}',
          pluginsJson: JSON.stringify([plugin]),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('restorePayload timed out')), 100)),
      ]),
    ).resolves.toBeUndefined();

    expect(mockSettings.fromJSON).toHaveBeenCalledWith('{}');
    expect(macros.findPlugin('cloud-restored-plugin')?.name).toBe('Cloud Restored');
  });

  it('includes bundled profile scripts in backup payload and restores them before settings', async () => {
    const profile = { id: 'portable', data: {}, scripts: [] };
    const bundled = { ...profile, scriptBundles: [{ scriptId: 'script', info: {}, codeObf: 'bytes' }] };
    const profiles = {
      buildBackupPayload: jest.fn(async () => bundled),
      restoreBackupProfile: jest.fn(async () => profile),
    };
    const settings = {
      toJSON: jest.fn(() => JSON.stringify({ profiles: [profile], stats: {} })),
      fromJSON: jest.fn(() => true),
      profiles,
    };
    const macros = { toJSON: jest.fn(() => '[]'), fromJSON: jest.fn(async () => undefined) };
    const CloudStorage = (await import('../../src/main/src/functions/storage/CloudStorage')).default;
    const shares = { state: () => ({ installed: {} }), restoreInstalled: jest.fn() };
    const storage = new CloudStorage({ settings, macros, clientEvents: { shares } } as any);
    (storage as any).encrypt = jest.fn(async (payload) => payload);

    const backup = JSON.parse((await (storage as any).createBackupFile('unused')).content);
    expect(JSON.parse(backup.settingsJson).profiles[0].scriptBundles).toEqual(bundled.scriptBundles);
    expect(JSON.stringify(backup)).not.toContain('recordings');

    await (storage as any).restorePayload(backup);
    expect(profiles.restoreBackupProfile).toHaveBeenCalledWith(bundled);
    expect(JSON.parse(settings.fromJSON.mock.calls[0][0]).profiles).toEqual([profile]);
  });
});
