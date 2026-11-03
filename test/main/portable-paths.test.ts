import path from 'path';
import fs from 'fs';
import { bootElectron, cleanupUserData, freshUserData } from './helpers';

afterAll(cleanupUserData);

test('portable root selection leaves device-only paths on the installation', () => {
  const device = freshUserData();
  const remote = freshUserData();
  bootElectron(device);
  const { selectPortableRoot, portablePath, devicePath, isPortableFile } = require('../../src/main/src/functions/storage/portablePaths');
  selectPortableRoot(remote);
  expect(portablePath('macros', 'plugin.json')).toBe(path.join(remote, 'macros', 'plugin.json'));
  expect(devicePath('minecraft-auth', 'account.json')).toBe(path.join(device, 'minecraft-auth', 'account.json'));
  expect(devicePath('plugin-security', 'trusted-publishers.json')).toBe(path.join(device, 'plugin-security', 'trusted-publishers.json'));
  expect(isPortableFile('plugin-security/provenance.json')).toBe(true);
  expect(isPortableFile('plugin-security/publisher-identity.json')).toBe(false);
  expect(isPortableFile('plugin-security/trusted-publishers.json')).toBe(false);
  expect(isPortableFile('macros/jnbot.d.ts')).toBe(false);
  expect(isPortableFile('profileScripts/_urlcache/hash.info.json')).toBe(false);
  expect(isPortableFile('minecraft-auth/account.json')).toBe(false);
  expect(isPortableFile('recordings/session.log')).toBe(false);
  expect(() => selectPortableRoot(device)).toThrow('cannot change');
});

test('launcher options migrate once while preserving shared identities and devices', () => {
  const root = freshUserData();
  const sharedPath = path.join(root, 'shared.json');
  const launcherPath = path.join(root, 'launcherOptions.json');
  const shared = { alts: [{ username: 'Alex' }], devices: [{ id: 'phone' }], pluginMetadata: {}, launcherOptions: { version: '1.21' } };
  fs.writeFileSync(sharedPath, JSON.stringify(shared));
  const { migrateLauncherOptions } = require('../../src/main/src/functions/storage/migrateLauncherOptions');
  migrateLauncherOptions(sharedPath, launcherPath);
  expect(JSON.parse(fs.readFileSync(launcherPath, 'utf8'))).toEqual(shared.launcherOptions);
  expect(JSON.parse(fs.readFileSync(sharedPath, 'utf8'))).toEqual({ alts: shared.alts, devices: shared.devices, pluginMetadata: {} });
  fs.writeFileSync(launcherPath, JSON.stringify({ version: '1.22' }));
  migrateLauncherOptions(sharedPath, launcherPath);
  expect(JSON.parse(fs.readFileSync(launcherPath, 'utf8'))).toEqual({ version: '1.22' });
});

test('settings, profiles, and stats use the selected root while recordings remain local', () => {
  const device = freshUserData();
  const remote = freshUserData();
  bootElectron(device);
  (global as any).send = jest.fn();
  (global as any).broadcast = jest.fn();
  const { selectPortableRoot } = require('../../src/main/src/functions/storage/portablePaths');
  selectPortableRoot(remote);
  const Settings = require('../../src/main/src/functions/Settings').default;
  const Recordings = require('../../src/main/src/functions/storage/Recordings').default;
  const settings = new Settings();
  expect(settings.appSettingsStorage.path).toBe(path.join(remote, 'appSettings'));
  expect(settings.sharedStorage.path).toBe(path.join(remote, 'shared.json'));
  expect(settings.stats.path).toBe(path.join(remote, 'stats.json'));
  expect(settings.profiles.storage.path).toBe(path.join(remote, 'profiles.json'));
  expect(new Recordings().recordingsPath).toBe(path.join(device, 'recordings'));
  expect(settings.launcherStorage.path).toBe(path.join(device, 'launcherOptions.json'));
  expect(fs.existsSync(path.join(device, 'shared.json'))).toBe(false);
  settings.close();
});

test('plugin provenance follows portable data while signing identity and trust stay local', () => {
  const device = freshUserData();
  const remote = freshUserData();
  bootElectron(device);
  const { selectPortableRoot } = require('../../src/main/src/functions/storage/portablePaths');
  selectPortableRoot(remote);
  const { PluginSecurityStore } = require('../../src/main/src/functions/signing');
  const security = new PluginSecurityStore();
  expect(security.provenancePath).toBe(path.join(remote, 'plugin-security', 'provenance.json'));
  expect(security.identityPath).toBe(path.join(device, 'plugin-security', 'publisher-identity.json'));
  expect(security.trustPath).toBe(path.join(device, 'plugin-security', 'trusted-publishers.json'));
});
