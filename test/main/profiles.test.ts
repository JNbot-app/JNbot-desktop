import path from 'path';
import { produce } from 'immer';
import {
  freshUserData,
  bootElectron,
  cleanupUserData,
  readJson,
  writeRaw,
  fileExists,
} from './helpers';
import {
  PROFILES_VERSION,
  generateProfileId,
  isPluginDisallowed,
  mergeProfilesIntoJNdata,
  type CustomProfile,
} from '../../src/common/profiles';

afterAll(cleanupUserData);
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** Build a minimal valid custom profile. */
function makeProfile(id: string): CustomProfile {
  return {
    id,
    predefined: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: {} as any,
    gamemodes: {} as any,
  };
}

/** Boot a fresh Profiles_ instance against an empty userData dir. */
function bootProfiles(dir = freshUserData()) {
  bootElectron(dir);
  const Profiles = require('../../src/main/src/functions/Profiles').default;
  const instance = new Profiles();
  const profilesPath = path.join(dir, 'profiles.json');
  return { instance, dir, profilesPath };
}

describe('Profiles_ cold start', () => {
  test('no profiles.json yet → creates empty list', () => {
    const { instance, profilesPath } = bootProfiles();
    expect(fileExists(profilesPath)).toBe(true);
    expect(instance.list).toEqual([]);
    expect(readJson(profilesPath)).toEqual({
      version: PROFILES_VERSION,
      profiles: [],
    });
  });
});

describe('Profiles_ CRUD + edge cases', () => {
  test('upsert adds, then updates in place (no duplicate)', () => {
    const { instance } = bootProfiles();
    instance.upsert(makeProfile('myserver'));
    instance.upsert(makeProfile('myserver'));
    expect(instance.list.filter((p: CustomProfile) => p.id === 'myserver'))
      .toHaveLength(1);
  });

  test('remove deletes the profile', () => {
    const { instance } = bootProfiles();
    instance.upsert(makeProfile('a'));
    instance.upsert(makeProfile('b'));
    instance.remove('a');
    expect(instance.list.map((p: CustomProfile) => p.id)).toEqual(['b']);
  });

  test('remove of a non-existent id is a no-op (no throw)', () => {
    const { instance } = bootProfiles();
    instance.upsert(makeProfile('a'));
    expect(() => instance.remove('does-not-exist')).not.toThrow();
    expect(instance.list).toHaveLength(1);
  });

  test('removing the last profile leaves an empty (valid) list', () => {
    const { instance } = bootProfiles();
    instance.upsert(makeProfile('only'));
    instance.remove('only');
    expect(instance.list).toEqual([]);
  });

  test('profile storage is not coupled to a hard-coded built-in id list', () => {
    const { instance } = bootProfiles();
    instance.upsert(makeProfile('jartexnetwork'));
    instance.upsert(makeProfile('pikanetwork'));
    expect(instance.list.map((p: CustomProfile) => p.id)).toEqual([
      'jartexnetwork',
      'pikanetwork',
    ]);
  });

  test('setAll strips invalid entries and normalizes valid profiles', () => {
    const { instance } = bootProfiles();
    instance.setAll([
      makeProfile('good'),
      makeProfile('jartexnetwork'),
      { id: '', predefined: false } as any, // no id → stripped
      null as any, // junk → stripped
    ]);
    expect(instance.list.map((p: CustomProfile) => p.id)).toEqual([
      'good',
      'jartexnetwork',
    ]);
    expect(instance.list.every((p: CustomProfile) => !p.predefined)).toBe(true);
  });
});

describe('profile plugin blocks', () => {
  test('matches only plugin ids configured for the active profile', () => {
    const profile = { disallowedPlugins: ['unsafe-plugin'] } as any;
    expect(isPluginDisallowed(profile, 'unsafe-plugin')).toBe(true);
    expect(isPluginDisallowed(profile, 'allowed-plugin')).toBe(false);
    expect(isPluginDisallowed(profile, '')).toBe(false);
  });
});

describe('profile export completeness', () => {
  test('refuses export when a declared script cannot be resolved', async () => {
    const { instance } = bootProfiles();
    (instance as any).scripts = {
      bundleForExport: jest.fn(async () => null),
    };
    const profile = {
      ...makeProfile('export-test'),
      scripts: [{ id: 'missing-script', pluginId: 'missing-plugin' }],
    } as any;

    await expect(instance.buildExportPayload(profile)).rejects.toThrow(
      'missing-script',
    );
  });

  test('bundles gamemode join actions and restores them on import', async () => {
    const { instance } = bootProfiles();
    const codeObf = require('../../src/main/src/functions/scriptObfuscate').obfuscateCodeToBase64({ code: 'function main() {}' });
    (instance as any).scripts = {
      bundleForExport: jest.fn(async (s: any) => ({ bundle: { scriptId: s.id, info: { pluginId: s.pluginId }, codeObf } })),
    };
    const profile = {
      ...makeProfile('join-action'),
      data: { joinBehaviours: {
        skyblock: { kind: 'action', action: { id: 'join_sb', pluginId: 'joiner', source: { kind: 'plugin', pluginId: 'joiner' } } },
        bedwars: { kind: 'direct' },
      } },
    } as any;

    const exported = await instance.buildExportPayload(profile);
    expect(exported.scriptBundles?.map((b: any) => b.scriptId)).toEqual(['join_sb']);

    const imported = await (instance as any).materializeImportedBundles(exported);
    expect(imported.data.joinBehaviours.bedwars).toEqual({ kind: 'direct' });
    expect(imported.data.joinBehaviours.skyblock.action.source).toEqual({
      kind: 'bundled',
      infoPath: 'profileScripts/join-action/join_sb.info.json',
      codePath: 'profileScripts/join-action/join_sb.code.jnc',
    });
  });
});

describe('portable bundled profile paths', () => {
  test('materializes imported bytes as relative references and rejects paths outside the data root', async () => {
    const { instance, dir } = bootProfiles();
    const profile = {
      ...makeProfile('portable'),
      scripts: [{ id: 'script', pluginId: 'script', source: { kind: 'bundled', infoPath: '/old/script.info.json', codePath: '/old/script.code.jnc' } }],
      scriptBundles: [{ scriptId: 'script', info: { pluginId: 'script' }, codeObf: require('../../src/main/src/functions/scriptObfuscate').obfuscateCodeToBase64({ code: 'raw-code' }) }],
    } as any;
    const imported = await (instance as any).materializeImportedBundles(profile);
    expect(imported?.scripts?.[0].source).toEqual({
      kind: 'bundled',
      infoPath: 'profileScripts/portable/script.info.json',
      codePath: 'profileScripts/portable/script.code.jnc',
    });
    expect(require('fs').readFileSync(path.join(dir, 'profileScripts/portable/script.code.jnc'))).toEqual(Buffer.from(profile.scriptBundles[0].codeObf, 'base64'));
    expect(() => instance.setAll([{ ...makeProfile('bad'), scripts: [{ id: 'bad', pluginId: 'bad', source: { kind: 'bundled', infoPath: '../escape', codePath: '../escape' } }] } as any])).toThrow();
  });

  test('normalizes legacy paths within this data root and drops URL cache paths', () => {
    const { instance, dir } = bootProfiles();
    instance.setAll([{ ...makeProfile('legacy'), scripts: [
      { id: 'bundle', pluginId: 'bundle', source: { kind: 'bundled', infoPath: path.join(dir, 'profileScripts/legacy/bundle.info.json'), codePath: path.join(dir, 'profileScripts/legacy/bundle.code.jnc') } },
      { id: 'url', pluginId: 'url', source: { kind: 'url', url: 'https://example.com/script.jnp', infoPath: '/other/device/cache.json' } },
      { id: 'plugin', pluginId: 'plugin', source: { kind: 'plugin', pluginId: 'plugin' } },
    ] } as any]);
    expect(instance.list[0].scripts?.map((s) => s.source)).toEqual([
      { kind: 'bundled', infoPath: 'profileScripts/legacy/bundle.info.json', codePath: 'profileScripts/legacy/bundle.code.jnc' },
      { kind: 'url', url: 'https://example.com/script.jnp', infoPath: '' },
      { kind: 'plugin', pluginId: 'plugin' },
    ]);
  });

  test('backup bundles restore script bytes under a different root while keeping URL and plugin references', async () => {
    const { instance: source, dir: sourceDir } = bootProfiles();
    const codeObf = require('../../src/main/src/functions/scriptObfuscate').obfuscateCodeToBase64({ code: 'module.exports = 7;' });
    const original = {
      ...makeProfile('across-devices'),
      scripts: [
        { id: 'file', pluginId: 'file', source: { kind: 'bundled', infoPath: 'profileScripts/across-devices/file.info.json', codePath: 'profileScripts/across-devices/file.code.jnc' } },
        { id: 'url', pluginId: 'url', source: { kind: 'url', url: 'https://example.com/script.jnp', infoPath: '/old/cache' } },
        { id: 'plugin', pluginId: 'plugin', source: { kind: 'plugin', pluginId: 'plugin' } },
      ],
      scriptBundles: [{ scriptId: 'file', info: { pluginId: 'file' }, codeObf }],
    } as any;
    const materialized = await (source as any).materializeImportedBundles(original);
    source.setAll([materialized]);
    (source as any).scripts = {
      bundleForExport: jest.fn(async () => ({
        bundle: { scriptId: 'file', info: JSON.parse(require('fs').readFileSync(path.join(sourceDir, materialized.scripts[0].source.infoPath), 'utf8')), codeObf: require('fs').readFileSync(path.join(sourceDir, materialized.scripts[0].source.codePath)).toString('base64') },
      })),
    };
    const backup = await source.buildBackupPayload(source.list[0]);
    expect(backup.scriptBundles).toHaveLength(1);
    expect(backup.scripts?.[1].source).toEqual({ kind: 'url', url: 'https://example.com/script.jnp', infoPath: '' });
    expect(backup.scripts?.[2].source).toEqual({ kind: 'plugin', pluginId: 'plugin' });

    const { instance: target, dir: targetDir } = bootProfiles();
    const restored = await (target as any).materializeImportedBundles(backup);
    expect(restored.scripts?.[0].source).toEqual(materialized.scripts[0].source);
    expect(require('fs').readFileSync(path.join(targetDir, 'profileScripts/across-devices/file.code.jnc'))).toEqual(
      require('fs').readFileSync(path.join(sourceDir, 'profileScripts/across-devices/file.code.jnc')),
    );
  });

  test('a failed bundled restore keeps the previous script files', async () => {
    const { instance, dir } = bootProfiles();
    const root = path.join(dir, 'profileScripts/stable');
    require('fs').mkdirSync(root, { recursive: true });
    require('fs').writeFileSync(path.join(root, 'old.code.jnc'), 'original');
    const bad = {
      ...makeProfile('stable'),
      scripts: [{ id: 'valid', pluginId: 'valid', source: { kind: 'bundled', infoPath: '', codePath: '' } },
        { id: '../escape', pluginId: 'escape', source: { kind: 'bundled', infoPath: '', codePath: '' } }],
      scriptBundles: [
        { scriptId: 'valid', info: {}, codeObf: Buffer.from('new').toString('base64') },
        { scriptId: '../escape', info: {}, codeObf: Buffer.from('bad').toString('base64') },
      ],
    } as any;
    await expect((instance as any).materializeImportedBundles(bad)).rejects.toThrow('Invalid bundled script id');
    expect(require('fs').readFileSync(path.join(root, 'old.code.jnc'), 'utf8')).toBe('original');
    expect(require('fs').readdirSync(root)).toEqual(['old.code.jnc']);
  });
});

describe('synced profile copies', () => {
  const sourceData = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'source',
      name: 'Source server',
      shortName: 'Source',
      defaultIp: 'updated.example.com',
      defaultPort: 25565,
      ips: [],
      gamemodes: ['Updated'],
      kitGamemodes: [],
      defaultGamemode: 'Updated',
      joinBehaviours: {},
      color: '#123456',
      icon: null,
      scripts: [{ id: 'updated-script' }],
      appSettingsDefaults: { delay_between_actions: 500 },
      ...overrides,
    }) as any;

  const baseJNdata = (data = sourceData()) =>
    ({
      version: 1,
      serverList: ['source'],
      data: { source: data },
      servers: {
        source: {
          updated: { ranks: { Hero: { price: 10 } }, gkits: {} },
        },
      },
      versions: [],
      fullVersions: [],
    }) as any;

  const syncedProfile = (): CustomProfile => ({
    ...makeProfile('source-synced'),
    sourceProfileId: 'source',
    data: sourceData({
      id: 'source-synced',
      name: 'My farming profile',
      shortName: 'Farming',
      defaultIp: 'snapshot.example.com',
      scripts: [{ id: 'snapshot-script' }],
    }),
    gamemodes: {
      snapshot: { ranks: {}, gkits: {} },
    },
    scripts: [{ id: 'snapshot-script' } as any],
  });

  test('uses current source data while preserving local identity', () => {
    const merged = mergeProfilesIntoJNdata(baseJNdata(), [syncedProfile()]);

    expect(merged.data['source-synced']).toMatchObject({
      id: 'source-synced',
      name: 'My farming profile',
      shortName: 'Farming',
      defaultIp: 'updated.example.com',
      scripts: [{ id: 'updated-script' }],
      appSettingsDefaults: { delay_between_actions: 500 },
    });
    expect(merged.servers['source-synced']).toEqual(
      baseJNdata().servers.source,
    );
  });

  test('adopts later source updates on the next merge', () => {
    const profile = syncedProfile();
    const updated = mergeProfilesIntoJNdata(
      baseJNdata(
        sourceData({
          defaultIp: 'next.example.com',
          scripts: [{ id: 'next-script' }],
        }),
      ),
      [profile],
    );

    expect(updated.data['source-synced'].defaultIp).toBe('next.example.com');
    expect(updated.data['source-synced'].scripts).toEqual([
      { id: 'next-script' },
    ]);
  });

  test('can merge JNdata while it is wrapped in an Immer draft', () => {
    expect(() =>
      produce({ jndata: baseJNdata() }, (draft) => {
        draft.jndata = mergeProfilesIntoJNdata(draft.jndata, [
          syncedProfile(),
        ]);
      }),
    ).not.toThrow();
  });

  test('falls back to the stored snapshot when the source is unavailable', () => {
    const base = baseJNdata();
    base.serverList = [];
    base.data = {};
    base.servers = {};

    const merged = mergeProfilesIntoJNdata(base, [syncedProfile()]);
    expect(merged.data['source-synced']).toMatchObject({
      id: 'source-synced',
      name: 'My farming profile',
      defaultIp: 'snapshot.example.com',
      scripts: [{ id: 'snapshot-script' }],
    });
    expect(merged.servers['source-synced']).toHaveProperty('snapshot');
  });

  test('leaves ordinary custom profiles unchanged', () => {
    const profile = syncedProfile();
    delete profile.sourceProfileId;
    const merged = mergeProfilesIntoJNdata(baseJNdata(), [profile]);

    expect(merged.data['source-synced'].defaultIp).toBe('snapshot.example.com');
    expect(merged.data['source-synced'].scripts).toEqual([
      { id: 'snapshot-script' },
    ]);
  });
});

describe('remote profile copy metadata', () => {
  test('upserts one deterministic local copy while retaining its source revision', () => {
    const { instance } = bootProfiles();
    instance.upsert({
      ...makeProfile('remote-abc'),
      remoteSource: {
        ownerId: 'owner-a',
        profileKey: 'jartexnetwork',
        revision: 'first',
      },
    });
    instance.upsert({
      ...makeProfile('remote-abc'),
      remoteSource: {
        ownerId: 'owner-a',
        profileKey: 'jartexnetwork',
        revision: 'second',
      },
    });

    expect(instance.list).toHaveLength(1);
    expect(instance.get('remote-abc')?.remoteSource).toEqual({
      ownerId: 'owner-a',
      profileKey: 'jartexnetwork',
      revision: 'second',
    });
  });
});

describe('profile ids', () => {
  test('generates random ids that avoid reserved ones', () => {
    const id = generateProfileId();
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(generateProfileId([id])).not.toBe(id);
  });
});

describe('Profiles_ corrupt / legacy file handling', () => {
  test('valid legacy profiles are retained regardless of their id', () => {
    const dir = freshUserData();
    writeRaw(
      path.join(dir, 'profiles.json'),
      JSON.stringify({
        version: PROFILES_VERSION,
        profiles: [makeProfile('keep'), makeProfile('jartexnetwork')],
      }),
    );
    const { instance } = bootProfiles(dir);
    expect(instance.list.map((p: CustomProfile) => p.id)).toEqual([
      'keep',
      'jartexnetwork',
    ]);
  });

  test('file missing a profiles array fails validation → empty list', () => {
    const dir = freshUserData();
    writeRaw(
      path.join(dir, 'profiles.json'),
      JSON.stringify({ version: 1, profiles: 'nope' }),
    );
    const { instance } = bootProfiles(dir);
    expect(instance.list).toEqual([]);
  });

  test('garbage (non-JSON) file → empty list, no throw', () => {
    const dir = freshUserData();
    writeRaw(path.join(dir, 'profiles.json'), 'not json at all');
    let instance: any;
    expect(() => {
      instance = bootProfiles(dir).instance;
    }).not.toThrow();
    expect(instance.list).toEqual([]);
  });
});
