jest.mock('../../src/main/src/functions/storage/Storage', () =>
  class {
    storage: unknown;
    constructor(_path: string, defaults: () => unknown) {
      this.storage = defaults();
    }
    get() {
      return this.storage;
    }
    save() {}
  },
);
jest.mock('../../src/main/src/functions/storage/portablePaths', () => ({
  portablePath: (name: string) => name,
  devicePath: (name: string) => name,
}));
jest.mock('../../src/main/src/functions/signing', () => ({
  pluginSecurity: () => ({ isReviewer: () => false }),
}));
jest.mock('../../src/main/UID', () => jest.fn(() => 'test-uid'));

// eslint-disable-next-line import/first
import CloudStorage from '../../src/main/src/functions/storage/CloudStorage';
// eslint-disable-next-line import/first
import ShareService from '../../src/main/src/functions/share/ShareService';
// eslint-disable-next-line import/first
import type { InstalledShare } from '../../src/common/share';

const installedProfile = (id: string, localRef: string) =>
  ({ id, kind: 'profile', localRef, revision: '0123456789abcdef' }) as InstalledShare;

/** One device: profiles it has, its shares, and the backup service on top. */
function device(profiles: string[]) {
  const publish = jest.fn();
  const settings = {
    profiles: undefined,
    getProfile: (id: string) => (profiles.includes(id) ? { id } : undefined),
    toJSON: () => '{}',
    fromJSON: () => true,
  };
  const macros = { toJSON: () => '[]', fromJSON: jest.fn(async () => undefined) };
  const shares = new ShareService({ settings, macros } as never, publish);
  const storage = new CloudStorage({ settings, macros, clientEvents: { shares } } as never, {
    keyId: 'key',
    applicationKey: 'secret',
    bucket: 'bucket',
    endpoint: 'https://backup.test',
    region: 'test',
  } as never);
  return { shares, storage, publish };
}

describe('installed shares in backups', () => {
  it('carries installs to the importing device, so it shows them as installed', async () => {
    const desktop = device(['pika']);
    desktop.shares.restoreInstalled({ AAAAAAAAAA: installedProfile('AAAAAAAAAA', 'pika') });
    const phone = device(['pika']);

    const archive = await desktop.storage.createDirectTransferArchive();
    await phone.storage.importDirectTransferArchive(archive.toString('utf8'));

    expect(phone.shares.state().installed.AAAAAAAAAA?.localRef).toBe('pika');
    expect(phone.publish).toHaveBeenCalled();
  });

  it('drops restored installs whose item is not on this device', () => {
    const phone = device([]);
    phone.shares.restoreInstalled({ AAAAAAAAAA: installedProfile('AAAAAAAAAA', 'pika') });
    expect(phone.shares.state().installed).toEqual({});
  });

  it('keeps installs when importing a backup made before they were included', async () => {
    const phone = device(['pika']);
    phone.shares.restoreInstalled({ AAAAAAAAAA: installedProfile('AAAAAAAAAA', 'pika') });
    await (phone.storage as unknown as { restorePayload(payload: object): Promise<void> }).restorePayload({
      settingsJson: '{}',
      pluginsJson: '[]',
    });
    expect(phone.shares.state().installed.AAAAAAAAAA).toBeDefined();
  });
});
