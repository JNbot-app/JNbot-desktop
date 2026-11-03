import fs from 'fs';
import os from 'os';
import path from 'path';
import Macros from '../../src/main/src/functions/Macros';
import { PluginSecurityStore, pluginContentDigest, pluginSecurity } from '../../src/main/src/functions/signing';

describe('portable mobile plugin transfer', () => {
  let directory: string;
  let macros: Macros;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-portable-plugin-'));
    (global as any).send = jest.fn();
    macros = new Macros({} as any);
    macros.macros_path = directory;
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  test('preserves signed legacy metadata through mobile preview, install, and export', async () => {
    const signer = new PluginSecurityStore(path.join(directory, 'signer'), []);
    signer.setPublisherName('Marketplace publisher');
    const info = macros.defaultPluginInfo({
      pluginId: 'advertiserJS',
      name: 'advertiser',
      language: 'js',
    });
    // Marketplace records can predate scriptType and contain legacy metadata.
    Reflect.deleteProperty(info, 'scriptType');
    const bundle = signer.sign({ ...info, flags: 8 }, { code: '\nconsole.log("advertise");\n' });
    const preview = macros.previewPortablePlugins([JSON.stringify(bundle)])[0];
    expect(preview.state).toBe('new');
    expect(preview.verification).toBe('valid-untrusted');
    expect(preview.package.bundle.info).toEqual(bundle.info);

    const result = await macros.importPortablePlugins([bundle], [{
      ...preview.package.source,
      revision: preview.package.revision,
      action: 'replace',
      acceptUnverified: true,
    }]);
    expect(result.failed).toEqual([]);
    expect(result.installed).toHaveLength(1);
    const exported = macros.exportPortablePlugin(info.pluginId);
    expect(exported.bundle.signature).toEqual(bundle.signature);
    expect(signer.verify(exported.bundle).status).toBe('trusted');
    expect(macros.previewPortablePlugins([bundle])[0].state).toBe('identical');

    const tampered = structuredClone(bundle);
    tampered.info.scriptType = 'script';
    expect(macros.previewPortablePlugins([tampered])[0].state).toBe('invalid');
  });

  test.each(['plugin-with-dashes', 'plugin_with_underscores'])(
    'accepts signed marketplace ID %s without rewriting it', (pluginId) => {
      const signer = new PluginSecurityStore(path.join(directory, 'signer'), []);
      signer.setPublisherName('Marketplace publisher');
      const info = macros.defaultPluginInfo({ pluginId, name: 'x'.repeat(250), language: 'js' });
      const bundle = signer.sign(info, { code: 'console.log("test");' });
      expect(macros.previewPortablePlugins([bundle])[0]).toMatchObject({
        state: 'new', verification: 'valid-untrusted',
      });
      expect(macros.parsePortablePlugin(bundle).bundle.info).toEqual(bundle.info);
      expect(macros.previewPortablePlugins([{ ...bundle, version: 3 }])[0].state).toBe('invalid');
      expect(macros.previewPortablePlugins([{
        ...bundle, code: { code: 'console.log("tampered");' },
      }])[0].state).toBe('invalid');
    },
  );

  test('does not export a stale signature after stored metadata changes', async () => {
    const signer = new PluginSecurityStore(path.join(directory, 'signer'), []);
    signer.setPublisherName('Marketplace publisher');
    const info = macros.defaultPluginInfo({ pluginId: 'migratedplugin', name: 'Before', language: 'js' });
    const code = { code: 'console.log("test");' };
    const bundle = signer.sign(info, code);
    await macros._importPlugin(bundle.info, code, 'Overwrite', bundle.signature, 'allow-unverified');
    const changedInfo = { ...bundle.info, name: 'After migration' };
    fs.writeFileSync(path.join(directory, '_migratedplugin.json'), JSON.stringify(changedInfo));
    pluginSecurity().setProvenance(info.pluginId, {
      status: 'accepted-once', signature: bundle.signature,
      contentDigest: pluginContentDigest(changedInfo, code), installedAt: Date.now(),
    });
    macros.invalidateLocalCache();
    const exported = macros.exportPortablePlugin(info.pluginId);
    expect(exported.bundle.signature).toBeUndefined();
    expect(macros.previewPortablePlugins([exported])[0].verification).toBe('unsigned');
  });

  test('exports executable metadata without local security state or option values', () => {
    const created = macros.create({
      name: 'Portable script',
      description: 'test transfer',
      language: 'js',
      scriptType: 'script',
    });
    const packageData = macros.exportPortablePlugin(created.pluginId);

    expect(packageData.version).toBe(1);
    expect(packageData.source.pluginId).toBe(created.pluginId);
    expect(packageData.bundle.info).toMatchObject({
      pluginId: created.pluginId,
      language: 'js',
      scriptType: 'script',
      public: false,
    });
    expect(packageData.bundle.info).not.toHaveProperty('security');
    expect(packageData.bundle.info).not.toHaveProperty('downloads');
    expect(packageData.bundle).not.toHaveProperty('settings');
  });

  test('classifies identical, conflicting, invalid, and unsupported packages', () => {
    const created = macros.create({
      name: 'Portable script',
      description: 'test transfer',
      language: 'js',
      scriptType: 'script',
    });
    const identical = macros.exportPortablePlugin(created.pluginId);
    expect(macros.previewPortablePlugins([identical])[0].state).toBe('identical');

    const conflict = structuredClone(identical);
    (conflict.bundle.code as { code: string }).code = 'module.exports = async () => 2;';
    conflict.revision = pluginContentDigest(conflict.bundle.info, conflict.bundle.code as any);
    expect(macros.previewPortablePlugins([conflict])[0].state).toBe('conflict');

    const invalid = structuredClone(conflict);
    invalid.revision = 'not-the-content-digest';
    expect(macros.previewPortablePlugins([invalid])[0].state).toBe('invalid');

    const unsupported = structuredClone(conflict);
    unsupported.bundle.info.scriptType = 'profileUi';
    unsupported.revision = pluginContentDigest(unsupported.bundle.info, unsupported.bundle.code as any);
    expect(macros.previewPortablePlugins([unsupported])[0].state).toBe('unsupported');
  });

  test('requires confirmation for unsigned code and can duplicate a conflict', async () => {
    const created = macros.create({
      name: 'Portable script',
      description: 'test transfer',
      language: 'js',
      scriptType: 'script',
    });
    const incoming = macros.exportPortablePlugin(created.pluginId);
    (incoming.bundle.code as { code: string }).code = 'module.exports = async () => 3;';
    incoming.revision = pluginContentDigest(incoming.bundle.info, incoming.bundle.code as any);
    const denied = await macros.importPortablePlugins([incoming], [{
      ownerId: incoming.source.ownerId,
      pluginId: incoming.source.pluginId,
      revision: incoming.revision,
      action: 'keep-both',
      acceptUnverified: false,
    }]);
    expect(denied.skipped[0]?.reason).toMatch(/not confirmed/i);

    const accepted = await macros.importPortablePlugins([incoming], [{
      ownerId: incoming.source.ownerId,
      pluginId: incoming.source.pluginId,
      revision: incoming.revision,
      action: 'keep-both',
      acceptUnverified: true,
    }]);
    expect(accepted.installed[0]).toMatchObject({ outcome: 'duplicated' });
    expect(accepted.installed[0]?.installedPluginId).not.toBe(created.pluginId);
  });

  test('skips unreadable plugins with warning during backup', () => {
    const info = macros.defaultPluginInfo({
      pluginId: 'missingcode',
      name: 'Missing code',
      language: 'js',
      scriptType: 'script',
    });
    fs.writeFileSync(
      path.join(directory, '_missingcode.json'),
      JSON.stringify(info),
    );

    const warnSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const backup = macros.toJSON();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Missing code'));
    expect(backup).not.toContain('missingcode');
    warnSpy.mockRestore();
  });
});
