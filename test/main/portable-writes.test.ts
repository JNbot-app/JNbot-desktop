import path from 'path';
import { bootElectron, cleanupUserData, freshUserData } from './helpers';

afterAll(cleanupUserData);

test('real storage writes are coalesced, failed writes keep session state, and a later edit saves it', async () => {
  const root = freshUserData();
  bootElectron(root);
  const {
    PortableWrites,
    setPortableWrites,
  } = require('../../src/main/src/functions/storage/PortableWrites');
  const {
    portableRoot,
  } = require('../../src/main/src/functions/storage/portablePaths');
  expect(portableRoot()).toBe(root);
  const StorageModule =
    require('../../src/main/src/functions/storage/Storage').default;
  const uploaded: string[] = [];
  let fail = false;
  const remote = {
    upload: jest.fn(
      async (_token: string, _relative: string, data: Buffer) => {
        if (fail) throw new Error('offline');
        uploaded.push(data.toString('utf8'));
      },
    ),
    delete: jest.fn(async () => undefined),
  };
  const writes = new PortableWrites(remote, async () => 'token', 20);
  setPortableWrites(writes);
  const store = new StorageModule(path.join(root, 'stats.json'), () => ({
    alts: {},
    scripts: {},
  }));
  await writes.flush();
  fail = true;
  store.set({ alts: { one: 1 }, scripts: {} });
  store.save();
  expect((await writes.flush()).lastError).toMatch(/offline/);
  expect(store.get().alts.one).toBe(1);
  fail = false;
  store.set({ alts: { one: 1, two: 2 }, scripts: {} });
  store.close();
  expect((await writes.flush()).lastError).toBeUndefined();
  expect(JSON.parse(uploaded.at(-1)!).alts).toEqual({ one: 1, two: 2 });
  expect(remote.upload.mock.calls.at(-1)?.[1]).toBe('stats.json');
  setPortableWrites();
});
