import { Version } from '@xmcl/core';
import { getVersionList, installVersion } from '@xmcl/installer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MinecraftLauncherTypes } from '../../src/common/CommonEnums';
import MinecraftVersion from '../../src/main/src/functions/minecraft/launcher/MinecraftVersion';
import { cleanupUserData, freshUserData } from './helpers';

jest.mock('@xmcl/installer', () => ({
  ...jest.requireActual('@xmcl/installer'),
  getVersionList: jest.fn(),
  installVersion: jest.fn(),
}));

afterAll(cleanupUserData);
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('Minecraft version installation', () => {
  jest.setTimeout(20000);

  test('reuses a valid cached version without fetching the manifest', async () => {
    const minecraftRoot = freshUserData();
    const cachedVersion = {
      id: '1.21.11',
      minecraftVersion: '1.21.11',
      downloads: {
        client: { sha1: '53cedd5a9e837f2a7ba77f69f72d7cb2661965f3' },
      },
    };
    const jarPath = path.join(
      minecraftRoot,
      'versions',
      '1.21.11',
      '1.21.11.jar',
    );
    await fs.mkdir(path.dirname(jarPath), { recursive: true });
    await fs.writeFile(jarPath, 'canonical jar');
    jest.spyOn(Version, 'parse').mockResolvedValue(cachedVersion as never);
    jest.mocked(getVersionList).mockRejectedValue(new Error('offline'));

    const version = await MinecraftVersion.fromVersionId('1.21.11', {
      launcher: MinecraftLauncherTypes.VANILLA,
      minecraftRoot,
    });

    expect(version.version.mcVersion).toBe(cachedVersion);
  });

  test('repairs a readable cached version through the canonical installer', async () => {
    const minecraftRoot = freshUserData();
    const cachedVersion = {
      id: '1.21.11',
      minecraftVersion: '1.21.11',
      downloads: { client: { sha1: 'expected-sha1' } },
    };
    const repairedVersion = { id: '1.21.11', source: 'canonical' };
    const versionMetadata = {
      id: '1.21.11',
      type: 'release',
      url: 'https://example.test/1.21.11.json',
      time: '2026-01-01T00:00:00.000Z',
      releaseTime: '2026-01-01T00:00:00.000Z',
    };

    const jarPath = path.join(
      minecraftRoot,
      'versions',
      '1.21.11',
      '1.21.11.jar',
    );
    await fs.mkdir(path.dirname(jarPath), { recursive: true });
    await fs.writeFile(jarPath, 'different jar');
    jest.spyOn(Version, 'parse').mockResolvedValue(cachedVersion as never);
    jest.mocked(getVersionList).mockResolvedValue({
      latest: { release: '1.21.11', snapshot: '1.21.11' },
      versions: [versionMetadata],
    });
    jest.mocked(installVersion).mockResolvedValue(repairedVersion as never);

    const version = await MinecraftVersion.fromVersionId('1.21.11', {
      launcher: MinecraftLauncherTypes.VANILLA,
      minecraftRoot,
    });

    expect(version.version.mcVersion).toBe(repairedVersion);
  });
});
