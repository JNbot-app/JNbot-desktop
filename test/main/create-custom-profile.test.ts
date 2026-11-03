import { createCustomProfile, DEFAULT_GAMEMODE } from '../../src/common/createCustomProfile';
import { mergeProfileAppSettings } from '../../src/common/appSettingsSchema';
import { mergeProfilesIntoJNdata } from '../../src/common/profiles';
import type { CreateProfileInput } from '../../src/common/mobileClientContract';

const basic: CreateProfileInput = { name: 'My server', host: 'play.example.com', port: 25565, onlineMode: true };
const plugins = [{ pluginId: 'run', scriptType: 'script' }, { pluginId: 'action', scriptType: 'action' }, { pluginId: 'ui', scriptType: 'profileUi' }];
const script = { id: 'stable', pluginId: 'run', source: { kind: 'plugin' as const, pluginId: 'run' }, order: 20, hidden: true };

it('preserves basic creation defaults and reserves generated IDs', () => {
  const first = createCustomProfile(basic, [], plugins);
  const second = createCustomProfile(basic, [first.id], plugins);
  expect(second.id).not.toBe(first.id);
  expect(first.data).toMatchObject({ name: 'My server', shortName: 'My server', defaultIp: basic.host, defaultPort: 25565, ips: [basic.host], onlineMode: true, gamemodes: [DEFAULT_GAMEMODE], icon: null, color: '#E6BF4C' });
  expect(first.data.appSettingsDefaults).toBeUndefined();
});

it('persists advanced fields and promotes them to the selected-profile data', () => {
  const input: CreateProfileInput = { ...basic, advanced: {
    shortName: 'Mine', color: '#1677FF', icon: 'https://example.com/logo.png', ips: ['proxy.example.com'],
    gamemodes: ['Skyblock'], kitGamemodes: ['Skyblock', 'Removed'], defaultGamemode: 'Removed',
    joinBehaviours: { skyblock: { kind: 'selector', hotbarSlot: 9, pick: 'slot', staticSlot: 53 }, removed: { kind: 'direct' } },
    ranksGkits: { skyblock: { ranks: { vip: { price: 10, color: '#FF0000' } }, gkits: { keys: 60 } }, removed: { ranks: {}, gkits: {} } },
    scripts: [script], marketplacePlugins: [script], disallowedPlugins: ['ui'],
    botExtensionAction: { id: 'bot', pluginId: 'action', source: { kind: 'plugin', pluginId: 'action' } },
    appSettingsDefaults: { join_delay_premium: 500, retryOnLoginFail: false, proxy: { enabled: true, urls: ['socks5://host:1080'] } },
  } };
  const profile = createCustomProfile(input, [], plugins);
  expect(profile.data.defaultGamemode).toBe('Skyblock');
  expect(profile.data.kitGamemodes).toEqual(['Skyblock']);
  expect(Object.keys(profile.data.joinBehaviours)).toEqual(['skyblock']);
  expect(Object.keys(profile.gamemodes)).toEqual(['skyblock']);
  expect(profile.scripts).toEqual([script]);
  const merged = mergeProfilesIntoJNdata({ serverList: [], data: {}, servers: {}, version: 1 }, [profile]);
  expect(merged.data[profile.id].scripts).toEqual([script]);
  expect(merged.servers[profile.id]).toEqual(profile.gamemodes);
  const activeSettings = { join_delay: 200, server: 'other' };
  expect(mergeProfileAppSettings(activeSettings, profile.data.appSettingsDefaults, { join_delay_premium: 800 }).join_delay_premium).toBe(800);
  expect(activeSettings).toEqual({ join_delay: 200, server: 'other' });
});

it.each([
  { gamemodes: ['Skyblock', 'skyblock'] },
  { gamemodes: ['Bad mode'] },
  { joinBehaviours: { skyblock: { kind: 'selector', hotbarSlot: 0, pick: 'name' } } },
  { joinBehaviours: { skyblock: { kind: 'selector', hotbarSlot: 1, pick: 'slot', staticSlot: 54 } } },
  { joinBehaviours: { skyblock: { kind: 'command', command: '' } } },
  { ranksGkits: { skyblock: { ranks: { vip: { price: -1, color: '#FF0000' } }, gkits: {} } } },
  { botExtensionAction: { id: 'bad', pluginId: 'ui', source: { kind: 'plugin', pluginId: 'ui' } } },
  { scripts: [{ id: 'missing', pluginId: 'missing', source: { kind: 'plugin', pluginId: 'missing' } }] },
  { scripts: [script, script] },
  { scripts: [{ ...script, source: { kind: 'url', url: 'https://example.com' } }] },
  { appSettingsDefaults: { port: 65536 } },
  { appSettingsDefaults: { join_delay: NaN } },
  { appSettingsDefaults: { proxy: { enabled: true, urls: [] } } },
  { appSettingsDefaults: { proxy: { enabled: true, urls: ['https://host:1080'] } } },
])('rejects malformed advanced configuration %j before persistence', (advanced) => {
  // Exercise the untrusted event boundary rather than the compile-time shape.
  expect(() => createCustomProfile(JSON.parse(JSON.stringify({ ...basic, advanced })), [], plugins)).toThrow();
});

it('ignores client-owned metadata and global default keys', () => {
  const input = JSON.parse(JSON.stringify({ ...basic, advanced: { id: 'injected', predefined: true, appSettingsDefaults: { theme: 'other', server: 'other', join_delay: 250 } } }));
  const profile = createCustomProfile(input, [], []);
  expect(profile.id).not.toBe('injected');
  expect(profile.predefined).toBe(false);
  expect(profile.data.appSettingsDefaults).toEqual({ join_delay: 250 });
});
