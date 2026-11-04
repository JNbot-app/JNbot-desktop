import EventEmitter from 'node:events';
import AccessControl from '../../src/main/src/functions/AccessControl';
import { remoteRestriction } from '../../src/main/src/functions/RemotePermissionPolicy';
import {
  CUSTOM_DEFAULT_REMOTE_PERMISSIONS,
  DEFAULT_REMOTE_PERMISSIONS,
  FULL_REMOTE_PERMISSIONS,
  MANAGE_ACCESS,
  MANAGE_PLUGINS,
  REMOTE_CAPABILITIES,
  STANDARD_REMOTE_PERMISSIONS,
  USE_ACCOUNTS,
  USE_ACTIVE_BOTS,
  USE_HOST_TOOLS,
  USE_SCRIPTS,
  normalizePermissions,
  permissionPreset,
  remoteAccessCapabilities,
  type ClientPrincipal,
} from '../../src/common/clientPermissions';
import {
  workerBotAddress,
  type TransportFrame,
} from '../../src/common/messaging';
import { BackendMessagingSystem } from '../../src/main/src/messaging/BackendMessaging';

const profileId = 7;
const scriptId = 3;
const botAddress = workerBotAddress(profileId, scriptId, 2);

class FakeWorker extends EventEmitter {
  postMessage = jest.fn();
}

function principal(
  permissionMask: number,
  profiles: string[] = ['jartexnetwork'],
): ClientPrincipal {
  return {
    kind: 'remote',
    subjectId: 'remote-test',
    permissions: normalizePermissions({
      profiles,
      permissionMask,
    }),
  };
}

function createHarness(permissionMask: number, profiles?: string[]) {
  const messaging = new BackendMessagingSystem();
  const dispatch = jest.fn(() => ({ accepted: true }));
  const invoke = jest.fn(() => ({ invoked: true }));
  const send = jest.fn(() => true);
  messaging.bindActionDispatcher(dispatch);
  messaging.bindInvokeDispatcher(invoke);
  messaging.bindSendDispatcher(send);
  const remotePrincipal = principal(permissionMask, profiles);
  const settings = {
    shared: {
      devices: [
        {
          id: remotePrincipal.subjectId,
          permissions: remotePrincipal.permissions,
        },
      ],
    },
  };
  const scriptHandler = {
    getRuntime: (runtimeProfileId: number) => {
      if (runtimeProfileId !== profileId) throw new Error('Unknown profile');
      return { profileKey: 'jartexnetwork' };
    },
  };
  new AccessControl(settings as never, scriptHandler as never, messaging);

  const received: TransportFrame[] = [];
  const remote = messaging.registerRemoteClient(
    (frame) => received.push(frame),
    remotePrincipal,
  );
  const worker = new FakeWorker();
  const disposeWorker = messaging.registerWorker(
    worker as never,
    profileId,
    scriptId,
  );

  const receive = (
    type: 'send' | 'request' | 'subscribe',
    event: string,
    to: number,
    data?: unknown,
    correlationId?: string,
  ) =>
    remote.receive({
      envelope: {
        version: 1,
        type,
        event,
        from: remote.address,
        to,
        data,
        correlationId,
      },
    });

  return {
    messaging,
    dispatch,
    invoke,
    send,
    received,
    remote,
    settings,
    worker,
    receive,
    dispose: () => {
      remote.dispose();
      disposeWorker();
    },
  };
}

function subscribeToProfile(harness: ReturnType<typeof createHarness>) {
  harness.receive('subscribe', 'profile:event', harness.remote.address, {
    target: { broadcast: 'profile-clients', profileId },
  });
}

describe('remote active-bot access', () => {
  jest.setTimeout(20000);

  test('requires account access for Microsoft logout', () => {
    expect(remoteRestriction.profileAction('MC_LOGOUT_MICROSOFT')).toBe(USE_ACCOUNTS);
  });

  test('denies unlisted application actions unless the device has full access', async () => {
    const denied = createHarness(DEFAULT_REMOTE_PERMISSIONS);
    denied.receive(
      'request',
      'client:action',
      0,
      { event: 'FUTURE_ACTION', data: { value: 1 } },
      'future-denied',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(denied.dispatch).not.toHaveBeenCalled();
    expect(denied.received[0]?.envelope.error?.code).toBe('PERMISSION_DENIED');
    denied.dispose();

    const full = createHarness(FULL_REMOTE_PERMISSIONS);
    full.receive(
      'request',
      'client:action',
      0,
      { event: 'FUTURE_ACTION', data: { value: 1 } },
      'future-allowed',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(full.dispatch).toHaveBeenCalledWith(
      'FUTURE_ACTION',
      { value: 1 },
      full.remote.address,
    );
    full.dispose();
  });

  test('routes remote invokes through the same request protocol', async () => {
    const harness = createHarness(FULL_REMOTE_PERMISSIONS);
    harness.receive(
      'request',
      'client:invoke',
      0,
      { channel: 'future-invoke', data: { value: 1 } },
      'future-invoke',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.invoke).toHaveBeenCalledWith(
      'future-invoke',
      { value: 1 },
      harness.remote.address,
    );
    expect(harness.received[0]?.envelope.data).toEqual({ invoked: true });
    harness.dispose();
  });

  test('routes legacy renderer sends through the same request protocol', async () => {
    const harness = createHarness(FULL_REMOTE_PERMISSIONS);
    harness.receive(
      'request',
      'client:send',
      0,
      { channel: 'future-send', data: { value: 1 } },
      'future-send',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.send).toHaveBeenCalledWith(
      'future-send',
      { value: 1 },
      harness.remote.address,
    );
    expect(harness.received[0]?.envelope.data).toBe(true);
    harness.dispose();
  });

  test('requires the accounts capability for account actions', async () => {
    const denied = createHarness(0);
    denied.receive(
      'request',
      'client:action',
      0,
      { event: 'ALTS_OF_PROFILE', data: 'jartexnetwork' },
      'accounts-denied',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(denied.dispatch).not.toHaveBeenCalled();
    expect(denied.received[0]?.envelope.error?.code).toBe(
      'PERMISSION_DENIED',
    );
    denied.dispose();

    const allowed = createHarness(USE_ACCOUNTS);
    allowed.receive(
      'request',
      'client:action',
      0,
      { event: 'ALTS_OF_PROFILE', data: 'jartexnetwork' },
      'accounts-allowed',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(allowed.dispatch).toHaveBeenCalledWith(
      'ALTS_OF_PROFILE',
      'jartexnetwork',
      allowed.remote.address,
    );
    allowed.dispose();
  });

  test('delivers live bot and script updates for the watched profile', () => {
    const harness = createHarness(DEFAULT_REMOTE_PERMISSIONS);
    subscribeToProfile(harness);

    harness.messaging.messenger.publishToProfile(
      profileId,
      'activeScripts',
      { 1: { name: 'Example' } },
    );
    harness.messaging.messenger.publishToProfile(profileId, 'activeBots', [
      { botId: 1 },
    ]);

    expect(harness.received.map((frame) => frame.envelope.data)).toEqual([
      {
        profileId,
        event: 'activeScripts',
        data: { 1: { name: 'Example' } },
      },
      { profileId, event: 'activeBots', data: [{ botId: 1 }] },
    ]);
    harness.dispose();
  });

  test.each(['chat', 'inventory'])(
    'standard access permits %s subscriptions',
    (event) => {
      const harness = createHarness(DEFAULT_REMOTE_PERMISSIONS);
      harness.receive('subscribe', event, botAddress);

      expect(harness.worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          frame: expect.objectContaining({
            envelope: expect.objectContaining({ event, to: botAddress }),
          }),
        }),
      );
      harness.dispose();
    },
  );

  test('custom access can hide bots without hiding script updates', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const harness = createHarness(USE_SCRIPTS);
    subscribeToProfile(harness);
    harness.receive('subscribe', 'inventory', botAddress);
    harness.receive('send', 'BOT_ACTION', botAddress, {
      action: 'chatMessage',
      data: ['hello'],
    });
    harness.messaging.messenger.publishToProfile(
      profileId,
      'activeScripts',
      {},
    );
    harness.messaging.messenger.publishToProfile(profileId, 'activeBots', [
      { botId: 1 },
    ]);

    expect(harness.worker.postMessage).not.toHaveBeenCalled();
    expect(harness.received).toHaveLength(1);
    expect(harness.received[0].envelope.data).toMatchObject({
      event: 'activeScripts',
    });
    harness.dispose();
    warn.mockRestore();
  });

  test('full access permits direct bot actions', () => {
    const harness = createHarness(FULL_REMOTE_PERMISSIONS);
    harness.receive('send', 'BOT_ACTION', botAddress, {
      action: 'chatMessage',
      data: ['hello'],
    });

    expect(harness.worker.postMessage).toHaveBeenCalledTimes(1);
    harness.dispose();
  });

  test('full access can open plugin source through the application API', async () => {
    const harness = createHarness(FULL_REMOTE_PERMISSIONS);
    harness.receive(
      'request',
      'client:action',
      0,
      { event: 'MACRO_CODE', data: 'plugin-id' },
      'plugin-source',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.dispatch).toHaveBeenCalledWith(
      'MACRO_CODE',
      'plugin-id',
      harness.remote.address,
    );
    harness.dispose();
  });

  test('desktop-interactive operations fail immediately with a typed error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const harness = createHarness(FULL_REMOTE_PERMISSIONS);
    harness.receive(
      'request',
      'client:action',
      0,
      { event: 'OPEN_PLUGIN_EXTERNAL', data: 'plugin-id' },
      'external-editor',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.received[0]?.envelope.error).toMatchObject({
      code: 'UNSUPPORTED_REMOTE',
      name: 'UnsupportedRemoteError',
    });
    harness.dispose();
    warn.mockRestore();
  });

  test('full access ignores selected-profile filters like local access', () => {
    const harness = createHarness(FULL_REMOTE_PERMISSIONS, []);
    subscribeToProfile(harness);

    harness.messaging.messenger.publishToProfile(profileId, 'activeBots', [
      { botId: 1 },
    ]);

    expect(harness.received[0]?.envelope.data).toMatchObject({
      profileId,
      event: 'activeBots',
    });
    harness.dispose();
  });

  test('stops bot delivery when permission is revoked', () => {
    const harness = createHarness(DEFAULT_REMOTE_PERMISSIONS);
    harness.settings.shared.devices[0].permissions = normalizePermissions({
      profiles: ['jartexnetwork'],
      permissionMask: 0,
    });

    harness.worker.emit('message', {
      __messenger: true,
      frame: {
        envelope: {
          version: 1,
          type: 'send',
          event: 'inventory',
          from: botAddress,
          to: harness.remote.address,
          data: [],
        },
      },
    });

    expect(harness.received).toEqual([]);
    harness.dispose();
  });

  test('migrates the previous standard mask and exposes client capabilities', () => {
    const permissions = normalizePermissions({ permissionMask: 1 });

    expect(permissions.permissionMask & USE_ACTIVE_BOTS).toBe(USE_ACTIVE_BOTS);
    expect(remoteAccessCapabilities(permissions.permissionMask)).toMatchObject({
      allowed: ['accounts', 'scripts', 'activeBots'],
      canUseAccounts: true,
      canUseScripts: true,
      canUseActiveBots: true,
      canUsePlugins: false,
    });
    expect(
      remoteAccessCapabilities(FULL_REMOTE_PERMISSIONS).canUsePlugins,
    ).toBe(true);
  });

  test('preserves custom permission configurations and differentiates presets reliably', () => {
    expect(permissionPreset(DEFAULT_REMOTE_PERMISSIONS)).toBe('standard');
    expect(permissionPreset(FULL_REMOTE_PERMISSIONS)).toBe('full');
    expect(permissionPreset(CUSTOM_DEFAULT_REMOTE_PERMISSIONS)).toBe('custom');
    expect(permissionPreset(0)).toBe('custom');

    // Baseline custom permissions start from Standard capabilities without the preset bit
    expect(CUSTOM_DEFAULT_REMOTE_PERMISSIONS).toBe(
      USE_ACCOUNTS | USE_SCRIPTS | USE_ACTIVE_BOTS,
    );
    expect(CUSTOM_DEFAULT_REMOTE_PERMISSIONS & STANDARD_REMOTE_PERMISSIONS).toBe(0);

    // Custom masks with 0, individual flags, or combinations are never reverted by normalizePermissions
    expect(normalizePermissions({ permissionMask: 0 }).permissionMask).toBe(0);
    expect(
      normalizePermissions({ permissionMask: USE_ACCOUNTS }).permissionMask,
    ).toBe(USE_ACCOUNTS);
    expect(
      normalizePermissions({ permissionMask: CUSTOM_DEFAULT_REMOTE_PERMISSIONS })
        .permissionMask,
    ).toBe(CUSTOM_DEFAULT_REMOTE_PERMISSIONS);

    // Legacy standard presets (1 and 65) still migrate cleanly to DEFAULT_REMOTE_PERMISSIONS
    expect(normalizePermissions({ permissionMask: 1 }).permissionMask).toBe(
      DEFAULT_REMOTE_PERMISSIONS,
    );
    expect(
      normalizePermissions({
        permissionMask: STANDARD_REMOTE_PERMISSIONS | USE_ACTIVE_BOTS,
      }).permissionMask,
    ).toBe(DEFAULT_REMOTE_PERMISSIONS);
  });

  test('provides all 8 capability booleans and the generic can() API', () => {
    const customCaps = remoteAccessCapabilities(
      USE_ACCOUNTS | MANAGE_PLUGINS | USE_HOST_TOOLS,
    );
    expect(customCaps.canUseAccounts).toBe(true);
    expect(customCaps.canUseScripts).toBe(false);
    expect(customCaps.canUseActiveBots).toBe(false);
    expect(customCaps.canUsePlugins).toBe(true);
    expect(customCaps.canChangeGlobalSettings).toBe(false);
    expect(customCaps.canManageProfiles).toBe(false);
    expect(customCaps.canManageAccess).toBe(false);
    expect(customCaps.canUseHostTools).toBe(true);

    expect(customCaps.can(REMOTE_CAPABILITIES.accounts)).toBe(true);
    expect(customCaps.can(REMOTE_CAPABILITIES.plugins)).toBe(true);
    expect(customCaps.can(REMOTE_CAPABILITIES.hostTools)).toBe(true);
    expect(customCaps.can(REMOTE_CAPABILITIES.scripts)).toBe(false);
    expect(customCaps.can(REMOTE_CAPABILITIES.activeBots)).toBe(false);
    expect(customCaps.can(REMOTE_CAPABILITIES.globalSettings)).toBe(false);
    expect(customCaps.can(REMOTE_CAPABILITIES.profiles)).toBe(false);
    expect(customCaps.can(REMOTE_CAPABILITIES.access)).toBe(false);

    const fullCaps = remoteAccessCapabilities(FULL_REMOTE_PERMISSIONS);
    for (const capability of Object.values(REMOTE_CAPABILITIES)) {
      expect(fullCaps.can(capability)).toBe(true);
    }
    expect(fullCaps.canChangeGlobalSettings).toBe(true);
    expect(fullCaps.canManageProfiles).toBe(true);
    expect(fullCaps.canManageAccess).toBe(true);
    expect(fullCaps.canUseHostTools).toBe(true);
  });

  test('applies permission updates immediately to active connections without reconnecting', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const harness = createHarness(CUSTOM_DEFAULT_REMOTE_PERMISSIONS);

    // Initial state: custom permissions have accounts, scripts, active bots, but NOT plugins
    harness.receive(
      'request',
      'client:action',
      0,
      { event: 'MACRO_CODE', data: 'my-plugin' },
      'macro-req-1',
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.received[0]?.envelope.error?.code).toBe('PERMISSION_DENIED');

    // Grant MANAGE_PLUGINS dynamically
    const updatedPerms = normalizePermissions({
      profiles: ['jartexnetwork'],
      permissionMask: CUSTOM_DEFAULT_REMOTE_PERMISSIONS | MANAGE_PLUGINS,
    });
    harness.settings.shared.devices[0].permissions = updatedPerms;
    harness.messaging.updateRemotePrincipalPermissions(
      harness.remote.address,
      updatedPerms,
    );

    // Request should now succeed immediately on the same active connection
    harness.receive(
      'request',
      'client:action',
      0,
      { event: 'MACRO_CODE', data: 'my-plugin' },
      'macro-req-2',
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(harness.dispatch).toHaveBeenCalledWith(
      'MACRO_CODE',
      'my-plugin',
      harness.remote.address,
    );
    expect(harness.received[1]?.envelope.data).toEqual({ accepted: true });

    // Revoke accounts dynamically
    const revokedAccountsPerms = normalizePermissions({
      profiles: ['jartexnetwork'],
      permissionMask: MANAGE_PLUGINS,
    });
    harness.settings.shared.devices[0].permissions = revokedAccountsPerms;
    harness.messaging.updateRemotePrincipalPermissions(
      harness.remote.address,
      revokedAccountsPerms,
    );

    harness.dispatch.mockClear();
    harness.receive(
      'request',
      'client:action',
      0,
      { event: 'ALTS_OF_PROFILE', data: 'jartexnetwork' },
      'alts-req-1',
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.received[2]?.envelope.error?.code).toBe('PERMISSION_DENIED');

    harness.dispose();
    warn.mockRestore();
  });

  test('allows instance transfer for all permission levels', async () => {
    for (const mask of [DEFAULT_REMOTE_PERMISSIONS, CUSTOM_DEFAULT_REMOTE_PERMISSIONS, 0]) {
      const harness = createHarness(mask);

      const operations = [
        { event: 'REQUEST_INSTANCE_TRANSFER', data: { requestId: 'req-1' } },
        { event: 'READ_INSTANCE_TRANSFER_CHUNK', data: { transferId: 'tx-1', index: 0 } },
        { event: 'COMPLETE_INSTANCE_TRANSFER', data: { transferId: 'tx-1' } },
        { event: 'CANCEL_INSTANCE_TRANSFER', data: { transferId: 'tx-1' } },
      ];

      for (let i = 0; i < operations.length; i += 1) {
        harness.receive(
          'request',
          'client:action',
          0,
          operations[i],
          `import-req-${i}`,
        );
      }
      await new Promise((resolve) => setImmediate(resolve));

      expect(harness.dispatch).toHaveBeenCalledTimes(operations.length);
      for (let i = 0; i < operations.length; i += 1) {
        expect(harness.received[i]?.envelope.data).toEqual({ accepted: true });
      }

      harness.dispose();
    }
  });

  test('importing settings requires full access', async () => {
    const elevated = DEFAULT_REMOTE_PERMISSIONS | MANAGE_ACCESS | MANAGE_PLUGINS;
    for (const mask of [DEFAULT_REMOTE_PERMISSIONS, CUSTOM_DEFAULT_REMOTE_PERMISSIONS, elevated, 0]) {
      const harness = createHarness(mask);
      harness.receive(
        'request',
        'client:action',
        0,
        { event: 'IMPORT_SETTINGS', data: { fileContent: '{}' } },
        'import-denied',
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(harness.dispatch).not.toHaveBeenCalled();
      expect(harness.received[0]?.envelope.error?.code).toBe('PERMISSION_DENIED');
      harness.dispose();
    }

    const full = createHarness(FULL_REMOTE_PERMISSIONS);
    full.receive(
      'request',
      'client:action',
      0,
      { event: 'IMPORT_SETTINGS', data: { fileContent: '{}' } },
      'import-allowed',
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(full.dispatch).toHaveBeenCalledTimes(1);
    full.dispose();
  });
});

