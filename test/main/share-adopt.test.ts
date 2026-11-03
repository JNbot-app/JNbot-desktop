import { createHash } from 'crypto';
import { gzipSync } from 'zlib';

const requests: string[] = [];
const responses = new Map<string, () => Response>();

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
  canonicalJson: JSON.stringify,
  publisherFingerprint: () => 'fp',
  pluginSecurity: () => ({
    verifyOfficialMessage: () => true,
    verifyValue: () => ({ status: 'trusted', fingerprint: 'fp' }),
    isPublisherTrusted: () => true,
    isOwnPublicKey: () => false,
    isOfficialPublicKey: () => true,
    isReviewer: () => false,
  }),
}));
jest.mock('../../src/main/src/functions/share/ShareApi', () => {
  const actual = jest.requireActual('../../src/main/src/functions/share/ShareApi');
  return {
    ...actual,
    shareOrigin: () => 'https://share.test',
    shareRequest: async (method: string, path: string) => {
      requests.push(`${method} ${path}`);
      return responses.get(`${method} ${path}`)?.() ?? new Response('{}');
    },
  };
});

// eslint-disable-next-line import/first
import ShareService from '../../src/main/src/functions/share/ShareService';

const SHARE_ID = 'AAAAAAAAAA';
const REVISION = '0123456789abcdef';

function officialProfileShare() {
  const listing = JSON.stringify({ kind: 'profile', minAppVersion: '0.0.1', servers: [], serverId: 'pikanetwork' });
  const envelope = {
    format: 'jnbot-share',
    version: 2,
    kind: 'profile',
    meta: { title: 'Pika', minAppVersion: '0.0.1', servers: [] },
    payload: { id: 'pikanetwork', data: { id: 'pikanetwork', name: 'Pika' } },
    plugins: [],
    signature: { publicKey: 'official', publisherName: 'JNbot' },
  };
  const content = gzipSync(JSON.stringify(envelope));
  const record = {
    id: SHARE_ID,
    kind: 'profile',
    ownerKey: 'official',
    ownerName: 'JNbot',
    visibility: 'public',
    status: 'live',
    revision: REVISION,
    listing,
    contentSha256: createHash('sha256').update(content).digest('hex'),
    approval: 'signed',
    hasBanner: false,
  };
  responses.set('GET /api/market', () => new Response(JSON.stringify({ entries: [record] }), { headers: { etag: 'e1' } }));
  responses.set(`GET /api/s/${SHARE_ID}/content/${REVISION}`, () => new Response(content));
}

describe('linking legacy profiles after an app update', () => {
  test('installs the official profile under the old id once, without asking again', async () => {
    officialProfileShare();
    let profiles: any[] = [];
    let legacy = ['pikanetwork'];
    const settings = {
      get legacyServers() {
        return legacy.filter((id) => !profiles.some((p) => p.id === id));
      },
      setLegacyServers: (ids: string[]) => {
        legacy = ids;
      },
      getProfile: (id: string) => profiles.find((p) => p.id === id),
      profiles: {
        get list() {
          return profiles;
        },
        bundleVerifications: () => [],
        materializeSyncedProfile: async (profile: unknown) => profile,
        upsert: (profile: any) => {
          profiles = [...profiles.filter((p) => p.id !== profile.id), profile];
        },
      },
      sharedAppSettings: {},
    };
    const service = new ShareService({ settings, macros: {}, profileTransfer: {} } as any, () => {});

    await service.adoptOfficialProfiles();
    expect(profiles).toEqual([expect.objectContaining({ id: 'pikanetwork', share: { id: SHARE_ID, official: true } })]);
    expect(legacy).toEqual([]);
    // The catalog record is reused: no extra record request.
    expect(requests).toEqual(['GET /api/market', `GET /api/s/${SHARE_ID}/content/${REVISION}`, `POST /api/s/${SHARE_ID}/install`]);
    expect(service.state().installed[SHARE_ID]).toMatchObject({ localRef: 'pikanetwork', listed: true });

    requests.length = 0;
    await service.adoptOfficialProfiles();
    expect(requests).toEqual([]);
  });
});
