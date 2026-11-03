import { normalizeProxyConfig } from '../../src/common/proxyConfig';
import {
  REMOTE_CAPABILITIES,
  USE_ACCOUNTS,
  USE_SCRIPTS,
  CHANGE_GLOBAL_SETTINGS,
  DEFAULT_REMOTE_PERMISSIONS,
  FULL_REMOTE_PERMISSIONS,
  MANAGE_PLUGINS,
  hasRemotePermission,
  normalizePermissions,
  remoteAccessCapabilities,
} from '../../src/common/clientPermissions';

describe('proxy pool compatibility', () => {
  test('migrates the former single-proxy shape', () => {
    expect(normalizeProxyConfig({ enabled: true, url: ' socks5://one:1080 ' }))
      .toEqual({ enabled: true, urls: ['socks5://one:1080'] });
  });

  test('normalizes a rotating pool without duplicate or empty entries', () => {
    expect(normalizeProxyConfig({ enabled: true, urls: ['socks5://one:1080', '', 'socks5://one:1080', ' socks4://two:1080 '] }))
      .toEqual({ enabled: true, urls: ['socks5://one:1080', 'socks4://two:1080'] });
  });
});

describe('remote access permissions', () => {
  test('standard access includes accounts, scripts, and active bots', () => {
    const capabilities = remoteAccessCapabilities(
      normalizePermissions(undefined).permissionMask,
    );

    expect(capabilities.allowed).toEqual([
      REMOTE_CAPABILITIES.accounts,
      REMOTE_CAPABILITIES.scripts,
      REMOTE_CAPABILITIES.activeBots,
    ]);
    expect(capabilities.canUseAccounts).toBe(true);
    expect(capabilities.canUseScripts).toBe(true);
    expect(capabilities.canUseActiveBots).toBe(true);
    expect(capabilities.canUsePlugins).toBe(false);
    expect(DEFAULT_REMOTE_PERMISSIONS & USE_ACCOUNTS).toBe(USE_ACCOUNTS);
    expect(DEFAULT_REMOTE_PERMISSIONS & USE_SCRIPTS).toBe(USE_SCRIPTS);
  });

  test('normalizes missing and invalid masks to standard access', () => {
    expect(normalizePermissions(undefined)).toMatchObject({ profiles: '*', permissionMask: DEFAULT_REMOTE_PERMISSIONS });
    expect(normalizePermissions({ permissionMask: 1.5 }).permissionMask).toBe(DEFAULT_REMOTE_PERMISSIONS);
    expect(normalizePermissions({ permissionMask: 2 ** 40 }).permissionMask).toBe(DEFAULT_REMOTE_PERMISSIONS);
    expect(DEFAULT_REMOTE_PERMISSIONS).not.toBe(0);
    expect(normalizePermissions({ permissionMask: 0 }).permissionMask).toBe(0);
  });

  test('keeps explicit profile grants and signed bitmasks', () => {
    const permissions = normalizePermissions({
      profiles: ['jartexnetwork', '', 'jartexnetwork'],
      permissionMask: CHANGE_GLOBAL_SETTINGS | MANAGE_PLUGINS,
    });
    expect(permissions.profiles).toEqual(['jartexnetwork']);
    expect(hasRemotePermission(permissions.permissionMask, CHANGE_GLOBAL_SETTINGS)).toBe(true);
    expect(hasRemotePermission(permissions.permissionMask, MANAGE_PLUGINS)).toBe(true);
    expect(normalizePermissions({ permissionMask: FULL_REMOTE_PERMISSIONS }).permissionMask).toBe(-1);
  });
});
