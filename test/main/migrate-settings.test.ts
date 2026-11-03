import path from 'path';
import fs from 'fs';
import {
  migrateLegacySettings,
  PREDEFINED_SERVERS,
} from '../../src/main/src/functions/storage/migrateSettings';
import { freshUserData, cleanupUserData, readJson, writeRaw } from './helpers';

describe('migrateSettings', () => {
  let tmpDir: string;
  let legacyPath: string;
  let sharedPath: string;
  let serverDir: string;
  let appSettingsPath: string;
  const defaultJNdata: any = { serverList: ['jartexnetwork', 'pikanetwork'] };

  beforeEach(() => {
    tmpDir = freshUserData();
    legacyPath = path.join(tmpDir, 'settings.json');
    sharedPath = path.join(tmpDir, 'shared.json');
    serverDir = path.join(tmpDir, 'serverSettings');
    appSettingsPath = path.join(tmpDir, 'appSettings.json');
  });

  afterAll(() => {
    cleanupUserData();
  });

  it('returns false if legacy settings file does not exist', () => {
    const result = migrateLegacySettings({
      legacyPath,
      sharedPath,
      serverDir,
      appSettingsPath,
      defaultJNdata,
    });
    expect(result).toBe(false);
    expect(fs.existsSync(sharedPath)).toBe(false);
  });

  it('returns false and creates a backup if sharedPath already exists', () => {
    writeRaw(legacyPath, JSON.stringify({ alts: [] }));
    writeRaw(sharedPath, JSON.stringify({ version: 3 }));

    const result = migrateLegacySettings({
      legacyPath,
      sharedPath,
      serverDir,
      appSettingsPath,
      defaultJNdata,
    });

    expect(result).toBe(false);
    expect(fs.existsSync(legacyPath + '.bak')).toBe(true);
  });

  it('returns false if legacy file has corrupt JSON', () => {
    writeRaw(legacyPath, '{ not valid json');

    const result = migrateLegacySettings({
      legacyPath,
      sharedPath,
      serverDir,
      appSettingsPath,
      defaultJNdata,
    });

    expect(result).toBe(false);
    expect(fs.existsSync(sharedPath)).toBe(false);
  });

  it('migrates full legacy settings.json into shared.json and serverSettings files', () => {
    const legacy = {
      alts: [
        {
          username: 'Player1',
          UID: 'uid-123',
          email: 'player1@test.com',
          premium: true,
          jartexnetwork: {
            password: 'pw-jartex',
            gkits: { kit1: 1 },
            ranks: { vip: true },
          },
          pikanetwork: {
            password: 'pw-pika',
          },
        },
        {
          username: 'Player2',
          UID: null,
        },
      ],
      devices: [{ id: 'dev-1', name: 'Mobile' }],
      launcherOptions: { memory: 4096 },
      reminders: [{ id: 'rem-1', text: 'Vote' }],
      triggers: { on_death: { active: 4, onByDefault: true } },
      scripts: {
        jartexnetwork: { scriptA: { enabled: true } },
      },
      altTags: {
        jartexnetwork: ['tag1'],
      },
    };

    writeRaw(legacyPath, JSON.stringify(legacy));
    writeRaw(appSettingsPath, JSON.stringify({ server: 'jartexnetwork' }));

    const result = migrateLegacySettings({
      legacyPath,
      sharedPath,
      serverDir,
      appSettingsPath,
      defaultJNdata,
    });

    expect(result).toBe(true);

    // 1. Check shared.json
    expect(fs.existsSync(sharedPath)).toBe(true);
    const shared = readJson(sharedPath);
    expect(shared.version).toBe(3);
    expect(shared.devices).toEqual(legacy.devices);
    expect(shared.launcherOptions).toEqual(legacy.launcherOptions);
    expect(shared.alts).toHaveLength(2);
    expect(shared.alts[0]).toEqual({
      username: 'Player1',
      UID: 'uid-123',
      email: 'player1@test.com',
    });
    expect(shared.alts[1]).toEqual({
      username: 'Player2',
      UID: null,
      email: undefined,
    });

    // 2. Check serverSettings for jartexnetwork
    const jartexFile = path.join(serverDir, 'jartexnetwork.json');
    expect(fs.existsSync(jartexFile)).toBe(true);
    const jartexSettings = readJson(jartexFile);
    expect(jartexSettings.version).toBe(3);
    expect(jartexSettings.altData.Player1).toEqual({
      premium: true,
      password: 'pw-jartex',
      gkits: { kit1: 1 },
      ranks: { vip: true },
    });
    expect(jartexSettings.reminders).toEqual(legacy.reminders);
    expect(jartexSettings.triggers).toEqual([
      {
        id: 'legacy-on_death',
        event: 'death',
        enabled: true,
        actions: [{ type: 'notification' }],
      },
    ]);
    expect(jartexSettings.scripts).toEqual(legacy.scripts.jartexnetwork);
    expect(jartexSettings.altTags).toEqual(['tag1']);

    // 3. Check serverSettings for pikanetwork
    const pikaFile = path.join(serverDir, 'pikanetwork.json');
    expect(fs.existsSync(pikaFile)).toBe(true);
    const pikaSettings = readJson(pikaFile);
    expect(pikaSettings.version).toBe(3);
    expect(pikaSettings.altData.Player1.password).toBe('pw-pika');
    // Reminders & triggers only assigned to currentServer (jartexnetwork)
    expect(pikaSettings.reminders).toEqual([]);
    expect(pikaSettings.triggers).toEqual([]);

    // 4. Legacy file backed up
    expect(fs.existsSync(legacyPath + '.bak')).toBe(true);
  });

  it('handles missing appSettings and defaults current server to jartexnetwork', () => {
    const legacy = {
      alts: [{ username: 'User1' }],
      reminders: [{ text: 'Check' }],
    };
    writeRaw(legacyPath, JSON.stringify(legacy));

    const result = migrateLegacySettings({
      legacyPath,
      sharedPath,
      serverDir,
      appSettingsPath,
      defaultJNdata,
    });

    expect(result).toBe(true);
    const jartexSettings = readJson(path.join(serverDir, 'jartexnetwork.json'));
    expect(jartexSettings.reminders).toEqual(legacy.reminders);
  });
});
