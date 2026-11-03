import path from 'path';
import fs from 'fs';
import {
  freshUserData,
  bootElectron,
  cleanupUserData,
} from './helpers';
import type { AltWithData } from '../../src/main/src/types';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => null) },
  get: jest.fn(async () => null),
}));

afterAll(cleanupUserData);
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function bootSettings(dir = freshUserData()) {
  bootElectron(dir);
  (global as any).send = jest.fn();
  (global as any).broadcast = jest.fn();
  const Settings = require('../../src/main/src/functions/Settings').default;
  const instance = new Settings();
  return { instance, dir };
}

const alt = (username: string, password = 'pw'): AltWithData => ({
  username,
  UID: null,
  data: {
    premium: false,
    password,
    gkits: {},
    ranks: {},
  },
});

describe('Settings backup passwords consistency', () => {
  test('toJSON encodes passwords consistently for both active and inactive profiles', () => {
    const { instance } = bootSettings();
    const active = instance.bootstrapProfileKey;
    const inactive = 'local';

    instance.setAltsForProfile(active, [alt('bot_active', 'active_secret_123')]);
    instance.setAltsForProfile(inactive, [alt('bot_inactive', 'inactive_secret_456')]);

    const backupJson = instance.toJSON();
    const backup = JSON.parse(backupJson);

    const activeStored = backup.perServer[active].altData.bot_active.password;
    const inactiveStored = backup.perServer[inactive].altData.bot_inactive.password;

    expect(activeStored).not.toBe('active_secret_123');
    expect(inactiveStored).not.toBe('inactive_secret_456');

    expect(/^[A-Za-z0-9+/]+={0,2}$/.test(activeStored)).toBe(true);
    expect(/^[A-Za-z0-9+/]+={0,2}$/.test(inactiveStored)).toBe(true);
  });

  test('fromJSON recovers passwords from legacy backups containing plaintext passwords', () => {
    const { instance } = bootSettings();
    const legacyBackup = JSON.parse(instance.toJSON());

    legacyBackup.perServer = {
      profileA: {
        scripts: {},
        reminders: [],
        triggers: {},
        altTags: [],
        pluginData: {},
        version: 2,
        altData: {
          botA: { password: 'plaintext_password_abc', ranks: {}, gkits: {} },
        },
      },
      profileB: {
        scripts: {},
        reminders: [],
        triggers: {},
        altTags: [],
        pluginData: {},
        version: 2,
        altData: {
          botB: {
            password: Buffer.from(Buffer.from('encoded_password_xyz').toString('hex')).toString('base64'),
            ranks: {},
            gkits: {},
          },
        },
      },
    };

    const ok = instance.fromJSON(JSON.stringify(legacyBackup));
    expect(ok).toBe(true);

    expect(instance.getAltPassword('botA', 'profileA')).toBe('plaintext_password_abc');
    expect(instance.getAltPassword('botB', 'profileB')).toBe('encoded_password_xyz');
  });

  test('full export -> import -> export roundtrip preserves all passwords', () => {
    const { instance: inst1 } = bootSettings();
    inst1.setAltsForProfile(inst1.bootstrapProfileKey, [alt('user1', 'superSecret99!')]);
    inst1.setAltsForProfile('jartexnetwork-copy', [alt('user2', 'copySecret88?')]);

    const exported1 = inst1.toJSON();
    inst1.close();

    const { instance: inst2 } = bootSettings();
    inst2.fromJSON(exported1);

    expect(inst2.getAltPassword('user1', inst1.bootstrapProfileKey)).toBe('superSecret99!');
    expect(inst2.getAltPassword('user2', 'jartexnetwork-copy')).toBe('copySecret88?');

    const exported2 = inst2.toJSON();
    inst2.close();

    const { instance: inst3 } = bootSettings();
    inst3.fromJSON(exported2);

    expect(inst3.getAltPassword('user1', inst1.bootstrapProfileKey)).toBe('superSecret99!');
    expect(inst3.getAltPassword('user2', 'jartexnetwork-copy')).toBe('copySecret88?');
    inst3.close();
  });
});
