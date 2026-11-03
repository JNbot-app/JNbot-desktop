import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { __setUserDataDir } from '../../__mocks__/electron';
import { removeMinecraftAuth } from '../../src/main/src/functions/minecraft/MinecraftAccountService';
import { getMinecraftAuthDir, minecraftAuthHash } from '../../src/main/src/functions/minecraft/minecraftPaths';

jest.mock('electron', () => jest.requireActual('../../__mocks__/electron'));

describe('Microsoft logout cache removal', () => {
  let userData: string;

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'jnbot-logout-'));
    __setUserDataDir(userData);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(userData, { recursive: true, force: true });
  });

  it('removes every token for the selected account and preserves other files', async () => {
    const dir = getMinecraftAuthDir(userData);
    await fs.mkdir(dir);
    const prefix = minecraftAuthHash('PlayerOne');
    const preserved = `${minecraftAuthHash('PlayerTwo')}_msa-cache.json`;
    const unrelated = `${prefix}_notes.json`;
    await Promise.all([
      `${prefix}_msa-cache.json`, `${prefix}_xbl-cache.json`,
      `${prefix}_mca-cache.json`, preserved, unrelated,
    ].map((name) => fs.writeFile(path.join(dir, name), '{}')));

    await removeMinecraftAuth('PlayerOne');
    expect((await fs.readdir(dir)).sort()).toEqual([preserved, unrelated].sort());
    await expect(removeMinecraftAuth('PlayerOne')).resolves.toBeUndefined();
  });

  it('succeeds when no login cache exists', async () => {
    await expect(removeMinecraftAuth('PlayerOne')).resolves.toBeUndefined();
  });

  it('reports directory read failures', async () => {
    const dir = getMinecraftAuthDir(userData);
    await fs.writeFile(dir, 'not a directory');
    await expect(removeMinecraftAuth('PlayerOne')).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('reports token deletion failures', async () => {
    const dir = getMinecraftAuthDir(userData);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, `${minecraftAuthHash('PlayerOne')}_msa-cache.json`), '{}');
    jest.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('Permission denied'));
    await expect(removeMinecraftAuth('PlayerOne')).rejects.toThrow('Permission denied');
  });
});
