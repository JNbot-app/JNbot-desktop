import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import MinecraftServerPluginManager from '../../src/main/src/functions/minecraftServer/MinecraftServerPluginManager';
import type { ModrinthVersion } from '../../src/main/src/functions/minecraftServer/ModrinthCatalog';
import { cleanupUserData, freshUserData } from './helpers';

const minecraftVersion = '1.21.11';
const payloads = {
  rootA: Buffer.from('root-a-v1'),
  rootA2: Buffer.from('root-a-v2'),
  rootB: Buffer.from('root-b-v1'),
  dependency: Buffer.from('shared-dependency'),
};

const version = (
  projectId: string,
  id: string,
  filename: string,
  payload: Buffer,
  dependencies: ModrinthVersion['dependencies'] = [],
): ModrinthVersion => ({
  id,
  project_id: projectId,
  name: id,
  version_number: id,
  version_type: 'release',
  date_published: '2026-01-01T00:00:00Z',
  game_versions: [minecraftVersion],
  loaders: ['fabric'],
  dependencies,
  files: [
    {
      filename,
      url: `https://cdn.example/${id}`,
      primary: true,
      hashes: {
        sha512: crypto.createHash('sha512').update(payload).digest('hex'),
      },
    },
  ],
});

const versions = {
  a1: version('a', 'a1', 'a.jar', payloads.rootA, [
    { project_id: 'dep', dependency_type: 'required' },
  ]),
  a2: version('a', 'a2', 'a.jar', payloads.rootA2, [
    { project_id: 'dep', dependency_type: 'required' },
  ]),
  b1: version('b', 'b1', 'b.jar', payloads.rootB, [
    { project_id: 'dep', dependency_type: 'required' },
  ]),
  dep1: version('dep', 'dep1', 'dep.jar', payloads.dependency, [
    { project_id: 'a', version_id: 'a1', dependency_type: 'required' },
  ]),
};

describe('managed Minecraft server plugins', () => {
  const userData = freshUserData();
  const serverDirectory = path.join(userData, 'server');
  const server = {
    id: 'server-1',
    version: minecraftVersion,
    directory: serverDirectory,
    running: false,
  };
  let manager: MinecraftServerPluginManager;
  let changed: jest.Mock;

  beforeAll(() => {
    require('electron').__setUserDataDir(userData);
  });

  beforeEach(() => {
    fs.rmSync(serverDirectory, { recursive: true, force: true });
    fs.rmSync(path.join(userData, 'minecraft-mod-cache'), {
      recursive: true,
      force: true,
    });
    changed = jest.fn();
    manager = new MinecraftServerPluginManager(() => server, changed);
    const catalog = manager.catalog as any;
    catalog.getRawProject = jest.fn(async (projectId: string) => ({
      id: projectId,
      slug: projectId,
      title: projectId.toUpperCase(),
      description: `${projectId} description`,
      body: '',
      downloads: 1,
      client_side: 'unsupported',
      server_side: 'required',
    }));
    catalog.getVersion = jest.fn(async (id: keyof typeof versions) => {
      const selected = versions[id];
      if (!selected) throw new Error(`Unknown version ${id}`);
      return selected;
    });
    catalog.resolveVersion = jest.fn(
      async (projectId: string, _mc: string, requested?: string) => {
        if (requested) return catalog.getVersion(requested);
        if (projectId === 'a') return versions.a2;
        if (projectId === 'b') return versions.b1;
        if (projectId === 'dep') return versions.dep1;
        throw new Error(`Unknown project ${projectId}`);
      },
    );
    jest.spyOn(axios, 'get').mockImplementation(async (url) => {
      const id = String(url).split('/').pop() as keyof typeof versions;
      const selected = versions[id];
      const payload =
        id === 'a1'
          ? payloads.rootA
          : id === 'a2'
            ? payloads.rootA2
            : id === 'b1'
              ? payloads.rootB
              : payloads.dependency;
      if (!selected) throw new Error('Missing download');
      return { data: payload } as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(cleanupUserData);

  test('pins exact versions, resolves cycles, and exposes explicit updates', async () => {
    const installed = await manager.install('server-1', 'a', 'a1');

    expect(installed.find((plugin) => plugin.projectId === 'a')).toMatchObject({
      versionId: 'a1',
      dependency: false,
      updateVersionId: 'a2',
    });
    expect(
      installed.find((plugin) => plugin.projectId === 'dep'),
    ).toMatchObject({
      dependency: true,
    });
    expect(
      fs.readFileSync(path.join(serverDirectory, 'mods', 'a.jar')),
    ).toEqual(payloads.rootA);
    expect(
      fs.readFileSync(path.join(serverDirectory, 'mods', 'dep.jar')),
    ).toEqual(payloads.dependency);
  });

  test('preserves a dependency until every root stops requiring it', async () => {
    await manager.install('server-1', 'a', 'a1');
    await manager.install('server-1', 'b', 'b1');
    await manager.remove('server-1', 'a');

    expect(fs.existsSync(path.join(serverDirectory, 'mods', 'dep.jar'))).toBe(
      true,
    );
    await manager.remove('server-1', 'b');
    expect(fs.existsSync(path.join(serverDirectory, 'mods', 'dep.jar'))).toBe(
      false,
    );
  });

  test('prepares online changes and applies them in one stopped reconciliation', async () => {
    server.running = true;
    await manager.install('server-1', 'a', 'a1');

    expect(await manager.state('server-1')).toEqual({
      pluginCount: 1,
      restartRequired: true,
    });
    expect(fs.existsSync(path.join(serverDirectory, 'mods', 'a.jar'))).toBe(
      false,
    );

    server.running = false;
    await manager.applyPending('server-1');
    expect(await manager.state('server-1')).toEqual({
      pluginCount: 1,
      restartRequired: false,
    });
    expect(fs.existsSync(path.join(serverDirectory, 'mods', 'a.jar'))).toBe(
      true,
    );
  });

  test('leaves desired and applied state unchanged after a bad download', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: Buffer.from('tampered'),
    } as any);

    await expect(manager.install('server-1', 'a', 'a1')).rejects.toThrow(
      'Hash verification failed',
    );
    expect(await manager.state('server-1')).toEqual({
      pluginCount: 0,
      restartRequired: false,
    });
    expect(
      fs.existsSync(path.join(serverDirectory, '.jnbot', 'plugins.json')),
    ).toBe(false);
  });

  test('preserves unmanaged jars and rejects filename collisions', async () => {
    const mods = path.join(serverDirectory, 'mods');
    fs.mkdirSync(mods, { recursive: true });
    fs.writeFileSync(path.join(mods, 'manual.jar'), 'manual');
    fs.writeFileSync(path.join(mods, 'a.jar'), 'different');

    await expect(manager.install('server-1', 'a', 'a1')).rejects.toThrow(
      'not managed by JNbot',
    );
    expect(fs.readFileSync(path.join(mods, 'manual.jar'), 'utf8')).toBe(
      'manual',
    );
    expect(fs.readFileSync(path.join(mods, 'a.jar'), 'utf8')).toBe('different');
    expect(await manager.state('server-1')).toEqual({
      pluginCount: 0,
      restartRequired: false,
    });
  });
});
