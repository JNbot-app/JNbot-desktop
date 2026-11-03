import fs from 'fs';
import path from 'path';
import { bootElectron, cleanupUserData, freshUserData } from './helpers';

afterAll(cleanupUserData);

test('desktop credentials use a local file without system credential storage', async () => {
  const device = freshUserData();
  bootElectron(device);
  const { FileDropboxCredentialStore } = require('../../src/main/src/functions/storage/StorageModeService');
  const { devicePath, isPortableFile } = require('../../src/main/src/functions/storage/portablePaths');
  const file = devicePath('dropbox-credentials.json');
  const store = new FileDropboxCredentialStore(file);
  const credentials = { accounts: [{ accountId: 'dbid:123', refreshToken: 'refresh-secret' }] };

  await store.write(credentials);
  expect(await store.read()).toEqual(credentials);
  expect(file).toBe(path.join(device, 'dropbox-credentials.json'));
  expect(fs.readFileSync(file, 'utf8')).toContain('refresh-secret');
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(isPortableFile('dropbox-credentials.json')).toBe(false);
});
