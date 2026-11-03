import path from 'path';
import fs from 'fs';
import {
  freshUserData,
  bootElectron,
  cleanupUserData,
  fileExists,
} from './helpers';
import type { AltWithData, ServerAltInfo } from '../../src/main/src/types';
import { makeEmptyProfile } from '../../src/common/profiles';
import { normalizePermissions } from '../../src/common/clientPermissions';

// Settings.fetchJNdata() hits GitHub on boot. Stub axios so tests never touch
// the network — the real code already falls back to bundled defaults on error.
jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => null) },
  get: jest.fn(async () => null),
}));

afterAll(cleanupUserData);
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/**
 * Boot a fresh Settings_ against an empty userData dir, wiring the `global`
 * broadcast helpers the module expects from the real main process.
 */
/** Servers are profiles: an official premium one (like an installed marketplace share) and a cracked one. */
function seedProfiles() {
  const Profiles = require('../../src/main/src/functions/Profiles').default;
  const premium = makeEmptyProfile('jartexnetwork');
  premium.data = { ...premium.data, name: 'JartexNetwork', onlineMode: true };
  premium.share = { id: 'AAAAAAAAAA', official: true };
  const cracked = makeEmptyProfile('local');
  cracked.data = { ...cracked.data, name: 'Local' };
  fs.mkdirSync(path.dirname(Profiles.profilesPath), { recursive: true });
  if (!fs.existsSync(Profiles.profilesPath)) {
    fs.writeFileSync(Profiles.profilesPath, JSON.stringify({ version: 1, profiles: [premium, cracked] }));
  }
}

function bootSettings(dir = freshUserData()) {
  const electron = bootElectron(dir);
  (global as any).send = jest.fn();
  (global as any).broadcast = jest.fn();
  seedProfiles();
  const Settings = require('../../src/main/src/functions/Settings').default;
  const instance = new Settings();
  return { instance, electron, dir };
}

const altData = (password = 'pw', premium = false): ServerAltInfo => ({
  premium,
  password,
  gkits: {},
  ranks: {},
});

const alt = (
  username: string,
  password = 'pw',
  premium = false,
): AltWithData => ({
  username,
  UID: null,
  data: altData(password, premium),
});

/** Update the bootstrap profile with a full alt list. */
function setAlts(instance: any, alts: AltWithData[]) {
  instance.setAltsForProfile(instance.bootstrapProfileKey, alts);
}

describe('Settings_ cold start (no files yet)', () => {
  test('creates global files without opening a profile store', () => {
    const { dir, instance } = bootSettings();
    expect(fileExists(path.join(dir, 'appSettings'))).toBe(true);
    expect(fileExists(path.join(dir, 'shared.json'))).toBe(true);
    const serverFile = path.join(
      dir,
      'serverSettings',
      `${instance.bootstrapProfileKey}.json`,
    );
    expect(fileExists(serverFile)).toBe(false);
    instance.getProfileSettings(instance.bootstrapProfileKey);
    expect(fileExists(serverFile)).toBe(true);
  });

  test('boots with empty alt list and valid shared shape', () => {
    const { instance } = bootSettings();
    expect(instance.shared.alts).toEqual([]);
    expect(Array.isArray(instance.shared.devices)).toBe(true);
    expect(instance.getAltsWithData()).toEqual([]);
  });

  test('defaults to a real server (not "other")', () => {
    const { instance } = bootSettings();
    expect(instance.bootstrapProfileKey).toBeTruthy();
    expect(instance.bootstrapProfileKey).not.toBe('other');
  });
});

describe('Settings_ remote access devices', () => {
  test('keeps legacy one-time devices and removes the trusted flag on write', () => {
    const dir = freshUserData();
    const firstBoot = bootSettings(dir);
    firstBoot.instance.close();

    const sharedPath = path.join(dir, 'shared.json');
    const shared = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
    shared.devices = [
      {
        id: 'legacy-once',
        token: 'once-token',
        name: 'Old phone',
        trusted: false,
      },
      {
        id: 'legacy-persistent',
        token: 'persistent-token',
        name: 'Tablet',
        trusted: true,
      },
    ];
    fs.writeFileSync(sharedPath, JSON.stringify(shared), 'utf8');

    const defaultPerms = normalizePermissions(undefined);
    const { instance } = bootSettings(dir);
    expect(instance.shared.devices).toEqual([
      { id: 'legacy-once', token: 'once-token', name: 'Old phone', permissions: defaultPerms },
      {
        id: 'legacy-persistent',
        token: 'persistent-token',
        name: 'Tablet',
        permissions: defaultPerms,
      },
    ]);

    instance.updateDevice('legacy-once', {
      id: 'legacy-once',
      token: 'once-token',
      name: 'Renamed phone',
    });
    instance.close();

    const persisted = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
    expect(persisted.devices).toEqual([
      {
        id: 'legacy-once',
        token: 'once-token',
        name: 'Renamed phone',
        permissions: defaultPerms,
      },
      {
        id: 'legacy-persistent',
        token: 'persistent-token',
        name: 'Tablet',
        permissions: defaultPerms,
      },
    ]);
  });

  test('device updates never remove persistent credentials', () => {
    const { instance } = bootSettings();
    const device = { id: 'phone', token: 'secret', name: 'My phone' };

    instance.updateDevice(device.id, device);
    instance.updateDevice(device.id, { ...device, name: 'Work phone' });

    expect(instance.shared.devices).toEqual([
      { ...device, name: 'Work phone' },
    ]);
  });

  test('keeps access links when a renderer update includes a stale device list', () => {
    const dir = freshUserData();
    const { instance } = bootSettings(dir);
    const device = { id: 'phone', token: 'secret', name: 'My phone' };
    instance.updateDevice(device.id, device);

    instance.updateShared({
      devices: [],
      pluginMetadata: { example: {} },
    });
    expect(instance.shared.devices).toEqual([device]);

    instance.close();
    const restarted = bootSettings(dir).instance;
    expect(restarted.shared.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: device.id, token: device.token }),
      ]),
    );
    restarted.close();
  });

  test('rejects an update with no renderer-owned fields', () => {
    const { instance } = bootSettings();
    const device = { id: 'phone', token: 'secret', name: 'My phone' };
    instance.updateDevice(device.id, device);

    const error = jest.spyOn(console, 'error').mockImplementation();
    instance.updateShared({ devices: [] });
    expect(error).toHaveBeenCalledWith('Invalid shared settings update: ', {
      devices: [],
    });
    error.mockRestore();

    expect(instance.shared.devices).toEqual([device]);
  });

  test('applies a renderer field update without replacing unrelated shared state', () => {
    const { instance } = bootSettings();
    const alts = [{ username: 'Steve', UID: null }];
    const launcherOptions = { username: 'Steve', version: '1.21.11' };
    instance.updateShared({ alts, launcherOptions });

    instance.updateShared({ pluginMetadata: { example: {} } });

    expect(instance.shared.alts).toEqual(alts);
    expect(instance.shared.launcherOptions).toEqual(launcherOptions);
    expect(instance.shared.pluginMetadata).toEqual({ example: {} });
  });
});

describe('Settings_ alt add / remove via alt-update IPC', () => {
  test('adding alts populates shared.alts + altData', () => {
    const { instance } = bootSettings();
    setAlts(instance, [alt('Steve'), alt('Alex')]);

    expect(instance.shared.alts.map((a: any) => a.username)).toEqual([
      'Steve',
      'Alex',
    ]);
    expect(instance.getAltsWithData().map((a) => a.username)).toEqual([
      'Steve',
      'Alex',
    ]);
  });

  test('shared.alts stores identity only (no password leak)', () => {
    const { instance } = bootSettings();
    setAlts(instance, [alt('Steve', 'secret', true)]);
    expect((instance.shared.alts[0] as any).password).toBeUndefined();
    expect((instance.shared.alts[0] as any).premium).toBeUndefined();
    // password lives in the per-server altData, encoded on disk
    expect(instance.getAltsWithData()[0].data.password).toBe('secret');
    expect(instance.getAltsWithData()[0].data.premium).toBe(true);
  });

  test('stores premium per profile for the same shared identity', () => {
    const { instance } = bootSettings();
    const premiumProfile = instance.bootstrapProfileKey;
    const crackedProfile = 'local';

    instance.setAltsForProfile(premiumProfile, [alt('Steve', 'pw', true)]);
    instance.setAltsForProfile(crackedProfile, [alt('Steve', 'pw', false)]);

    expect((instance.shared.alts[0] as any).premium).toBeUndefined();
    expect(instance.getAltsWithDataForProfile(premiumProfile)[0].data.premium).toBe(
      true,
    );
    expect(instance.getAltsWithDataForProfile(crackedProfile)[0].data.premium).toBe(
      false,
    );
  });

  // Deletion is PROFILE-SCOPED by design: dropping an alt from the active
  // profile's list removes its per-server `altData` (so it disappears from
  // getAltsWithData) but KEEPS the cross-server identity in shared.alts, since
  // it may still be used by another profile (see deleteAlt in settingReducers).
  test('removing one alt from the active profile clears its active-server data', () => {
    const { instance } = bootSettings();
    setAlts(instance, [alt('Steve'), alt('Alex')]);
    setAlts(instance, [alt('Steve')]); // Alex removed from active profile
    expect(instance.getAltsWithData().map((a) => a.username)).toEqual([
      'Steve',
    ]);
    expect(
      instance.getProfileSettings(instance.bootstrapProfileKey).altData.Alex,
    ).toBeUndefined();
  });

  test('removed alt keeps its shared identity (multi-profile design)', () => {
    const { instance } = bootSettings();
    setAlts(instance, [alt('Steve'), alt('Alex')]);
    setAlts(instance, [alt('Steve')]);
    // Identity preserved on purpose — Alex may belong to another profile.
    expect(instance.shared.alts.map((a: any) => a.username)).toContain('Alex');
  });

  test('removing the LAST alt leaves a valid empty active-profile state', () => {
    const { instance } = bootSettings();
    setAlts(instance, [alt('Solo')]);
    setAlts(instance, []); // remove last from active profile
    expect(instance.getAltsWithData()).toEqual([]);
    expect(
      instance.getProfileSettings(instance.bootstrapProfileKey).altData,
    ).toEqual({});
    // shared.alts still valid (array), identity may persist
    expect(Array.isArray(instance.shared.alts)).toBe(true);
  });

  test('rejects non-array profile alt updates without wiping data', () => {
    const { instance } = bootSettings();
    setAlts(instance, [alt('Steve')]);
    expect(() =>
      instance.setAltsForProfile(instance.bootstrapProfileKey, 'garbage'),
    ).toThrow('Alts must be an array');
    expect(instance.shared.alts.map((a: any) => a.username)).toEqual(['Steve']);
  });

  test('reordering alts is persisted in shared.alts order', () => {
    const { instance } = bootSettings();
    setAlts(instance, [alt('A'), alt('B'), alt('C')]);
    setAlts(instance, [alt('C'), alt('A'), alt('B')]);
    expect(instance.shared.alts.map((a: any) => a.username)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });
});

describe('Settings_ persistence round-trip', () => {
  test('alts survive a reboot from the same userData dir', () => {
    const dir = freshUserData();
    {
      const { instance } = bootSettings(dir);
      setAlts(instance, [alt('Persist')]);
      // flush debounced writes
      instance.sharedStorage.close();
      instance.close();
    }
    // Re-open against the same dir.
    const { instance } = bootSettings(dir);
    expect(instance.shared.alts.map((a: any) => a.username)).toEqual([
      'Persist',
    ]);
    expect(instance.getAltsWithData()[0]?.data.password).toBe('pw');
  });

  test('migrates legacy shared premium only when the active profile is used', () => {
    const dir = freshUserData();
    const first = bootSettings(dir);
    const profiles = [first.instance.bootstrapProfileKey, 'local'];
    for (const profileKey of profiles) first.instance.getProfileSettings(profileKey);
    first.instance.close();

    const sharedPath = path.join(dir, 'shared.json');
    const shared = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
    shared.alts = [{ username: 'Steve', premium: true, UID: null }];
    shared.version = 2;
    fs.writeFileSync(sharedPath, JSON.stringify(shared), 'utf8');

    for (const profileKey of profiles) {
      const profilePath = path.join(
        dir,
        'serverSettings',
        `${profileKey}.json`,
      );
      const settings = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      settings.altData = {
        Steve: { password: 'pw', gkits: {}, ranks: {} },
      };
      settings.version = 2;
      fs.writeFileSync(profilePath, JSON.stringify(settings), 'utf8');
    }

    const { instance } = bootSettings(dir);
    expect((instance.shared.alts[0] as any).premium).toBe(true);
    expect(instance.getAltsWithDataForProfile('local')[0].data.premium).toBeUndefined();

    expect(instance.getAltsWithData()[0].data.premium).toBe(true);
    expect(instance.getProfileSettings(instance.bootstrapProfileKey).version).toBe(3);
    expect(instance.getProfileSettings('local').version).toBe(2);

    instance.close();
    const persistedShared = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
    expect(persistedShared.alts[0].premium).toBeUndefined();
    const inactive = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'serverSettings', 'local.json'),
        'utf8',
      ),
    );
    expect(inactive.version).toBe(2);
    expect(inactive.altData.Steve.premium).toBeUndefined();
  });

  test('does not rerun the premium migration for a newer profile version', () => {
    const dir = freshUserData();
    const first = bootSettings(dir);
    const active = first.instance.bootstrapProfileKey;
    first.instance.getProfileSettings(active);
    first.instance.close();

    const sharedPath = path.join(dir, 'shared.json');
    const shared = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
    shared.alts = [{ username: 'Steve', premium: true, UID: null }];
    fs.writeFileSync(sharedPath, JSON.stringify(shared), 'utf8');

    const profilePath = path.join(dir, 'serverSettings', `${active}.json`);
    const settings = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    settings.version = 100;
    settings.altData = { Steve: { password: 'pw', gkits: {}, ranks: {} } };
    fs.writeFileSync(profilePath, JSON.stringify(settings), 'utf8');

    const { instance } = bootSettings(dir);
    expect(instance.getAltsWithData()[0].data.premium).toBe(false);
    instance.close();

    const persisted = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    expect(persisted.version).toBe(100);
    expect(persisted.altData.Steve.premium).toBeUndefined();
  });

  test('imports legacy v1 profile alt data with premium scoped to each profile', () => {
    const { instance } = bootSettings();
    const legacyBackup = {
      settings: {
        alts: [
          {
            username: 'Steve',
            premium: true,
            UID: null,
            jartexnetwork: { password: 'pw', gkits: {}, ranks: {} },
            pikanetwork: { password: 'pw', gkits: {}, ranks: {} },
          },
        ],
        scripts: {},
        altTags: {},
        reminders: [],
        triggers: {},
        devices: [],
        launcherOptions: {},
      },
    };

    expect(instance.fromJSON(JSON.stringify(legacyBackup))).toBe(true);
    expect(instance.shared.alts[0]).toEqual({ username: 'Steve', UID: null });
    expect(
      instance.getAltsWithDataForProfile('jartexnetwork')[0].data.premium,
    ).toBe(true);
    expect(
      instance.getAltsWithDataForProfile('pikanetwork')[0].data.premium,
    ).toBe(true);
  });

  test('persists a profile as the startup default without changing the live profile', () => {
    const { instance, dir } = bootSettings();
    instance.profiles.upsert(makeEmptyProfile('custom-profile'));
    const liveProfile = instance.bootstrapProfileKey;

    expect(instance.setDefaultProfile('custom-profile')).toBe(true);
    expect(instance.bootstrapProfileKey).toBe(liveProfile);

    instance.setSharedAppSetting('theme', 'dark');
    instance.appSettingsStorage.close();
    const stored = JSON.parse(
      fs.readFileSync(path.join(dir, 'appSettings'), 'utf8'),
    );
    expect(stored.server).toBe('custom-profile');
    expect(stored.lastProfile).toBe('custom-profile');
  });
});

describe('Settings_ app setting ownership', () => {
  test('applies a settings batch with one persistence event', () => {
    const { instance } = bootSettings();
    const profileKey = instance.bootstrapProfileKey;
    const profileEvent = jest.fn();
    instance.on(`profile:appSettings:${profileKey}`, profileEvent);

    const next = instance.updateAppSettings(profileKey, [
      { key: 'ip', value: 'batch.example.test' },
      { key: 'port', value: 25570 },
      { key: 'proxy', value: { enabled: true, urls: ['host:1080'] } },
    ]);

    expect(next.ip).toBe('batch.example.test');
    expect(next.port).toBe(25570);
    expect(next.proxy).toEqual({ enabled: true, urls: ['host:1080'] });
    expect(profileEvent).toHaveBeenCalledTimes(1);
  });

  test('writes a profile setting only to that profile', () => {
    const { instance } = bootSettings();
    const profileEvent = jest.fn();
    const sharedEvent = jest.fn();
    instance.on(
      `profile:appSettings:${instance.bootstrapProfileKey}`,
      profileEvent,
    );
    instance.on('sharedAppSettings', sharedEvent);

    instance.setAppSetting(
      instance.bootstrapProfileKey,
      'ip',
      'new.example.test',
    );

    expect(instance.getProfileAppSettings(instance.bootstrapProfileKey).ip).toBe(
      'new.example.test',
    );
    expect(profileEvent).toHaveBeenCalledTimes(1);
    expect(sharedEvent).not.toHaveBeenCalled();
  });

  test('writes a global setting only to shared app settings', () => {
    const { instance } = bootSettings();
    const profileEvent = jest.fn();
    const sharedEvent = jest.fn();
    instance.on(
      `profile:appSettings:${instance.bootstrapProfileKey}`,
      profileEvent,
    );
    instance.on('sharedAppSettings', sharedEvent);

    instance.setAppSetting(
      instance.bootstrapProfileKey,
      'sidebarCollapsed',
      true,
    );

    expect(instance.sharedAppSettings.sidebarCollapsed).toBe(true);
    expect(sharedEvent).toHaveBeenCalledTimes(1);
    expect(profileEvent).not.toHaveBeenCalled();
  });

  test('keeps app settings when a general profile setting changes', () => {
    const { instance } = bootSettings();
    const profileKey = instance.bootstrapProfileKey;

    instance.setAppSetting(profileKey, 'join_delay', 60000);

    instance.updateProfileSettings(profileKey, {
      path: ['scripts', 'chat', 'gamemode'],
      value: 'survival',
    });

    expect(instance.getProfileAppSettings(profileKey).join_delay).toBe(60000);
    expect(instance.getProfileSettings(profileKey).scripts.chat.gamemode).toBe(
      'survival',
    );
  });

  test('migrates legacy profile app settings into the app settings store', () => {
    const dir = freshUserData();
    const first = bootSettings(dir);
    const profileKey = first.instance.bootstrapProfileKey;
    first.instance.getProfileSettings(profileKey);
    first.instance.close();

    const profilePath = path.join(
      dir,
      'serverSettings',
      `${profileKey}.json`,
    );
    const profileSettings = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    profileSettings.appSettings = { join_delay: 60000 };
    fs.writeFileSync(profilePath, JSON.stringify(profileSettings), 'utf8');

    const second = bootSettings(dir);
    expect(second.instance.getProfileAppSettings(profileKey).join_delay).toBe(
      60000,
    );
    second.instance.close();

    const migratedProfile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const appSettings = JSON.parse(
      fs.readFileSync(path.join(dir, 'appSettings'), 'utf8'),
    );
    expect(migratedProfile.appSettings).toBeUndefined();
    expect(appSettings.profileOverrides[profileKey].join_delay).toBe(60000);
  });
});

describe('Settings_ servers from the old server list', () => {
  const bootWithLegacy = (installedServers: string[], lastProfile: string) => {
    const dir = freshUserData();
    fs.writeFileSync(
      path.join(dir, 'appSettings'),
      JSON.stringify({ server: lastProfile, lastProfile, installedServers }),
    );
    return bootSettings(dir);
  };

  test('waits for the official profile instead of switching away from it', () => {
    const { instance } = bootWithLegacy(['pikanetwork', 'jartexnetwork'], 'pikanetwork');
    // jartexnetwork is already a profile, so only pikanetwork is pending.
    expect(instance.legacyServers).toEqual(['pikanetwork']);
    expect(instance.bootstrapProfileKey).toBe('pikanetwork');
  });

  test('forgets the old list once every server is restored', () => {
    const { instance, dir } = bootWithLegacy(['pikanetwork'], 'jartexnetwork');
    instance.setLegacyServers([]);
    expect(instance.legacyServers).toEqual([]);
    instance.close();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'appSettings'), 'utf8')).installedServers).toBeUndefined();
  });
});
