import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { bootElectron, cleanupUserData, freshUserData } from './helpers';

afterAll(() => {
  const { setPortableWrites } = require('../../src/main/src/functions/storage/PortableWrites');
  setPortableWrites();
  require('../../src/main/src/functions/storage/portableFs').clearPortableMemory();
  require('../../src/main/src/functions/storage/portablePaths').releasePortableRoot();
  cleanupUserData();
});

function fixture(
  files: Record<string, string> = {},
  downloadStatus = 200,
  onUpload?: (name: string) => Promise<Response | undefined>,
) {
  const device = freshUserData();
  bootElectron(device);
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const http = jest.fn(async (url: string, options: RequestInit = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth2/token')) {
      const body = options.body as URLSearchParams;
      return Response.json(body.get('grant_type') === 'authorization_code'
        ? { access_token: 'short-lived', refresh_token: 'refresh-secret' }
        : { access_token: 'short-lived' });
    }
    if (url.endsWith('/users/get_current_account')) {
      return Response.json({ account_id: 'dbid:123', email: 'alex@example.com', name: { display_name: 'Alex' } });
    }
    if (url.endsWith('/files/download_zip')) {
      if (downloadStatus !== 200) return new Response(downloadStatus === 409 ? 'path/not_found/' : 'unavailable', { status: downloadStatus });
      const archive = new AdmZip();
      for (const [name, content] of Object.entries(files)) archive.addFile(`JNbot/${name}`, Buffer.from(content));
      return new Response(archive.toBuffer());
    }
    if (url.endsWith('/files/upload')) {
      const name = JSON.parse((options.headers as Record<string, string>)['Dropbox-API-Arg']).path.slice('/JNbot/'.length);
      const response = await onUpload?.(name);
      if (response) return response;
      files[name] = Buffer.from(options.body as Buffer).toString('utf8');
      return Response.json({ path_display: `/JNbot/${name}` });
    }
    if (url.endsWith('/files/delete_v2')) {
      const name = JSON.parse(options.body as string).path.slice('/JNbot/'.length);
      delete files[name];
      return Response.json({});
    }
    throw new Error(`Unexpected Dropbox API route: ${url}`);
  });
  const { DropboxHttp } = require('../../src/main/src/functions/storage/DropboxHttp');
  const { StorageModeService, FileDropboxCredentialStore } = require('../../src/main/src/functions/storage/StorageModeService');
  const api = new DropboxHttp('public-app-key', http);
  const service = new StorageModeService(api, new FileDropboxCredentialStore(path.join(device, 'dropbox-credentials.json')), device);
  return { device, calls, api, service };
}

test('migrates one saved account and switches between connected Dropbox accounts', async () => {
  const { device, api, service } = fixture();
  const credentialFile = path.join(device, 'dropbox-credentials.json');
  fs.writeFileSync(credentialFile, JSON.stringify({ accountId: 'dbid:old', refreshToken: 'old-token', email: 'old@example.com' }));
  expect((await service.status()).accounts.map((account: { id: string }) => account.id)).toEqual(['dbid:old']);
  jest.spyOn(api, 'account').mockResolvedValueOnce({ account_id: 'dbid:new', email: 'new@example.com' });
  await service.completeLogin('code', service.beginLogin().verifier);
  expect((await service.status()).accounts).toHaveLength(2);
  await service.select('dropbox', 'dbid:new');
  expect((await service.status()).account?.id).toBe('dbid:new');
  const tokenSpy = jest.spyOn(api, 'accessToken');
  await service.prepareStartup();
  expect(tokenSpy).toHaveBeenCalledWith('refresh-secret');
  await expect(service.select('dropbox', 'dbid:missing')).rejects.toThrow(/Select a connected/);
  expect((await service.status()).account?.id).toBe('dbid:new');
  expect(JSON.parse(fs.readFileSync(credentialFile, 'utf8')).accounts).toHaveLength(2);
  expect(JSON.parse(fs.readFileSync(path.join(device, 'storage-mode.json'), 'utf8')).accountId).toBe('dbid:new');
  await expect(service.disconnect('dbid:new')).rejects.toThrow(/Switch to Local/);
  await service.disconnect('dbid:old');
  expect((await service.status()).accounts.map((account: { id: string }) => account.id)).toEqual(['dbid:new']);
});

test('pending session writes stay on the original account during a switch', async () => {
  const { service, api } = fixture();
  await service.completeLogin('old-code', service.beginLogin().verifier);
  await service.select('dropbox');
  const root = await service.prepareStartup();
  jest.spyOn(api, 'exchangeCode').mockResolvedValueOnce('new-secret');
  jest.spyOn(api, 'account').mockResolvedValueOnce({ account_id: 'dbid:new' });
  await service.completeLogin('new-code', service.beginLogin().verifier);
  const tokenSpy = jest.spyOn(api, 'accessToken');
  await service.select('dropbox', 'dbid:new');
  const portableFs = require('../../src/main/src/functions/storage/portableFs').default;
  portableFs.writeFileSync(path.join(root!, 'shared.json'), JSON.stringify({ alts: [], devices: [] }));
  await service.flush();
  expect(tokenSpy).toHaveBeenLastCalledWith('refresh-secret');
});

test('an import queues many files without concurrent Dropbox writes', async () => {
  const files: Record<string, string> = {};
  let active = 0;
  const { service, calls } = fixture(files, 200, async () => {
    if (active) return new Response('too many write operations', { status: 429, headers: { 'Retry-After': '0' } });
    active += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return undefined;
  });
  await service.completeLogin('code', service.beginLogin().verifier);
  await service.select('dropbox');
  const root = await service.prepareStartup();
  const portableFs = require('../../src/main/src/functions/storage/portableFs').default;
  portableFs.mkdirSync(path.join(root!, 'macros'), { recursive: true });
  for (let index = 0; index < 20; index += 1)
    portableFs.writeFileSync(path.join(root!, 'macros', `plugin-${index}.js`), `plugin ${index}`);
  expect((await service.flush())?.lastError).toBeUndefined();
  expect(Object.keys(files)).toHaveLength(20);
  expect(calls.filter(({ url, options }) => url.endsWith('/oauth2/token') &&
    (options.body as URLSearchParams).get('grant_type') === 'refresh_token')).toHaveLength(1);
});

test('a Dropbox 429 waits and retries the upload', async () => {
  const files: Record<string, string> = {};
  let attempts = 0;
  const { service } = fixture(files, 200, async () => {
    attempts += 1;
    return attempts === 1
      ? new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } })
      : undefined;
  });
  await service.completeLogin('code', service.beginLogin().verifier);
  await service.select('dropbox');
  const root = await service.prepareStartup();
  const portableFs = require('../../src/main/src/functions/storage/portableFs').default;
  portableFs.writeFileSync(path.join(root!, 'shared.json'), JSON.stringify({ alts: [], devices: [] }));
  expect((await service.flush())?.lastError).toBeUndefined();
  expect(attempts).toBe(2);
  expect(files['shared.json']).toContain('alts');
});

test('a persistent rate limit reports one failure for an import', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { service } = fixture({}, 200, async () =>
      new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }));
    await service.completeLogin('code', service.beginLogin().verifier);
    await service.select('dropbox');
    const root = await service.prepareStartup();
    const portableFs = require('../../src/main/src/functions/storage/portableFs').default;
    portableFs.mkdirSync(path.join(root!, 'macros'), { recursive: true });
    portableFs.writeFileSync(path.join(root!, 'macros', 'one.js'), 'one');
    portableFs.writeFileSync(path.join(root!, 'macros', 'two.js'), 'two');
    expect((await service.flush())?.lastError).toContain('429');
    expect(log).toHaveBeenCalledTimes(1);
  } finally {
    log.mockRestore();
  }
});

test('defaults to Local and uses PKCE with only App Folder file and account scopes', async () => {
  const { device, api, service, calls } = fixture();
  expect(await service.status()).toEqual({ mode: 'local', connected: false, account: undefined, accounts: [], startupState: 'idle', startupError: undefined });
  const { url, verifier } = service.beginLogin();
  const authorize = new URL(url);
  expect(authorize.searchParams.get('response_type')).toBe('code');
  expect(authorize.searchParams.get('token_access_type')).toBe('offline');
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('scope')).toBe('files.metadata.read files.content.read files.content.write account_info.read');
  expect(authorize.searchParams.has('redirect_uri')).toBe(false);
  expect(verifier.length).toBeGreaterThanOrEqual(43);
  await service.completeLogin('authorization-code', verifier);
  expect((await service.status()).account?.email).toBe('alex@example.com');
  expect(calls[0].options.body?.toString()).toContain('code_verifier=');
  expect(fs.readFileSync(path.join(device, 'dropbox-credentials.json'), 'utf8')).toContain('refresh-secret');
  expect(fs.existsSync(path.join(device, 'shared.json'))).toBe(false);
  expect(api.appKey).toBe('public-app-key');
});

test('empty Dropbox store opens fresh without copying Local, and disconnect preserves remote data', async () => {
  const { device, service, calls } = fixture({}, 409);
  fs.writeFileSync(path.join(device, 'shared.json'), '{"alts":[{"username":"Local"}],"devices":[]}');
  await service.completeLogin('code', service.beginLogin().verifier);
  await service.select('dropbox');
  const root = await service.prepareStartup();
  expect(root).toBeTruthy();
  expect(fs.existsSync(path.join(root!, 'shared.json'))).toBe(false);
  expect(fs.readFileSync(path.join(device, 'shared.json'), 'utf8')).toContain('Local');
  await service.select('local');
  await service.disconnect();
  expect((await service.status()).mode).toBe('local');
  expect(calls.some(({ url }) => url.includes('/files/delete'))).toBe(false);
});

test('existing Dropbox files remain in memory without a working directory', async () => {
  const shared = JSON.stringify({ alts: [{ username: 'Dropbox' }], devices: [], pluginMetadata: {}, version: 3 });
  const plugins = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`macros/plugin-${index}.js`, `plugin ${index}`]));
  const { service, calls } = fixture({ 'shared.json': shared, ...plugins });
  await service.completeLogin('code', service.beginLogin().verifier);
  await service.select('dropbox');
  const root = await service.prepareStartup();
  const portableFs = require('../../src/main/src/functions/storage/portableFs').default;
  expect(JSON.parse(portableFs.readFileSync(path.join(root!, 'shared.json'), 'utf8')).alts).toEqual([{ username: 'Dropbox' }]);
  expect(portableFs.readFileSync(path.join(root!, 'macros', 'plugin-149.js'), 'utf8')).toBe('plugin 149');
  expect(calls.filter(({ url }) => url.endsWith('/files/download_zip'))).toHaveLength(2); // selection, then startup
  expect(calls.some(({ url }) => url.endsWith('/files/download'))).toBe(false);
  expect(fs.existsSync(root!)).toBe(false);
});

test('return-to-use refresh detects a remote edit without replacing the current session', async () => {
  const files = {
    'shared.json': JSON.stringify({ alts: [], devices: [], pluginMetadata: {}, version: 3 }),
  };
  const { service } = fixture(files);
  await service.completeLogin('code', service.beginLogin().verifier);
  await service.select('dropbox');
  const root = await service.prepareStartup();
  expect(await service.refreshNeeded()).toBe(false);
  files['shared.json'] = JSON.stringify({ alts: [{ username: 'remote' }], devices: [], pluginMetadata: {}, version: 3 });
  expect(await service.refreshNeeded()).toBe(true);
  const portableFs = require('../../src/main/src/functions/storage/portableFs').default;
  expect(JSON.parse(portableFs.readFileSync(path.join(root!, 'shared.json'), 'utf8')).alts).toEqual([]);
});

test.each([
  ['invalid data', { 'shared.json': '{bad json' }, 200],
  ['unknown file', { 'minecraft-auth/token.json': '{}' }, 200],
  ['unavailable folder', {}, 503],
] as const)('%s blocks startup without selecting cached data', async (_, files, status) => {
  const { service, device } = fixture(files, status);
  await service.completeLogin('code', service.beginLogin().verifier);
  fs.writeFileSync(path.join(device, 'storage-mode.json'), '{"mode":"dropbox"}');
  await expect(service.prepareStartup()).rejects.toThrow(/Retry the command/);
  await service.select('local');
  expect((await service.status()).mode).toBe('local');
});

test('portable writes upload from memory while recordings stay local', async () => {
  const files = {
    'shared.json': JSON.stringify({ alts: [], devices: [], pluginMetadata: {}, version: 3 }),
    'recordings/old.log': 'previously uploaded recording',
  };
  const { device, service, calls } = fixture(files);
  await service.completeLogin('code', service.beginLogin().verifier);
  await service.select('dropbox');
  const root = await service.prepareStartup();
  const portableFs = require('../../src/main/src/functions/storage/portableFs').default;
  portableFs.writeFileSync(path.join(root!, 'shared.json'), JSON.stringify({ alts: [{ username: 'new' }], devices: [], version: 3 }));
  portableFs.mkdirSync(path.join(root!, 'macros'), { recursive: true });
  await new Promise<void>((resolve, reject) => portableFs.writeFile(
    path.join(root!, 'macros', 'demo.js'),
    'console.log("new plugin");',
    (error: Error | null) => error ? reject(error) : resolve(),
  ));
  const { default: Recordings } = require('../../src/main/src/functions/storage/Recordings');
  const recordings = new Recordings();
  await recordings.updateRecordingData('local-only', 'packet');
  await service.flush();
  expect(files['shared.json']).toContain('new');
  expect(files).toHaveProperty(['macros/demo.js'], 'console.log("new plugin");');
  expect(fs.readFileSync(path.join(device, 'recordings', 'local-only.log'), 'utf8')).toBe('packet');
  expect(calls.filter(({ url }) => url.endsWith('/files/upload'))).toHaveLength(2);
  expect(calls.filter(({ url }) => url.endsWith('/files/download_zip')).map(({ options }) =>
    JSON.parse((options.headers as Record<string, string>)['Dropbox-API-Arg']).path,
  )).toEqual(['/JNbot', '/JNbot']);
  expect(files['recordings/old.log']).toBe('previously uploaded recording');
  expect(fs.existsSync(root!)).toBe(false);
});

test('Settings and plugin readers use the same in-memory Dropbox store', async () => {
  const files = { 'macros/demo.js': 'console.log("Dropbox plugin");' };
  const { service } = fixture(files);
  await service.completeLogin('code', service.beginLogin().verifier);
  await service.select('dropbox');
  const root = await service.prepareStartup();
  (global as any).send = jest.fn();
  (global as any).broadcast = jest.fn();
  const Settings = require('../../src/main/src/functions/Settings').default;
  const Macros = require('../../src/main/src/functions/Macros').default;
  const settings = new Settings();
  const macros = new Macros({} as any);
  expect(macros.readPlugin('demo')).toEqual({ code: files['macros/demo.js'] });
  expect(settings.sharedStorage.path).toBe(path.join(root!, 'shared.json'));
  settings.close();
  await service.flush();
  expect(files).toHaveProperty(['shared.json']);
  expect(fs.existsSync(root!)).toBe(false);
});

test('nested uploads create each missing parent folder before retrying', async () => {
  const folders = new Set<string>();
  const writes: string[] = [];
  const http = jest.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/files/create_folder_v2')) {
      const folder = JSON.parse(options.body as string).path as string;
      folders.add(folder);
      return Response.json({ metadata: { path_display: folder } });
    }
    if (url.endsWith('/files/upload')) {
      const file = JSON.parse((options.headers as Record<string, string>)['Dropbox-API-Arg']).path as string;
      writes.push(file);
      const parent = file.slice(0, file.lastIndexOf('/'));
      return folders.has(parent)
        ? Response.json({ path_display: file })
        : new Response('{"error_summary":"path/not_found/"}', { status: 409 });
    }
    throw new Error(`Unexpected Dropbox API route: ${url}`);
  });
  const { DropboxHttp } = require('../../src/main/src/functions/storage/DropboxHttp');
  await new DropboxHttp('public-app-key', http).upload('token', 'macros/example.js', Buffer.from('code'));
  expect([...folders]).toEqual(['/JNbot', '/JNbot/macros']);
  expect(writes).toEqual(['/JNbot/macros/example.js', '/JNbot/macros/example.js']);
});
