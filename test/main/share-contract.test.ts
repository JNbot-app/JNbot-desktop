import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { gzipSync } from 'zlib';
import {
  approvalMessage,
  canInstallShare,
  compareAppVersion,
  shareMatchesServer,
  shareUpdateAvailable,
  sniffImageType,
  type InstalledShare,
} from '../../src/common/share';
import { PluginSecurityStore } from '../../src/main/src/functions/signing';
import { packContent, unpackContent } from '../../src/main/src/functions/share/ShareApi';

describe('share contract', () => {
  test('compares app versions numerically and ignores build suffixes', () => {
    expect(compareAppVersion('3.10.0', '3.9.9')).toBe(1);
    expect(compareAppVersion('3.3.1-cli', '3.3.1')).toBe(0);
    expect(canInstallShare('3.4.0', '3.3.1')).toBe(false);
    expect(canInstallShare('3.3.1', '3.3.1')).toBe(true);
  });

  test('only offers updates this app version can install', () => {
    const installed: InstalledShare = {
      id: 'AAAAAAAAAA',
      kind: 'profile',
      localRef: 'jartexnetwork',
      revision: 'old',
      ownerKey: 'k',
      ownerName: 'JNbot',
      latestRevision: 'new',
      latestMinAppVersion: '3.4.0',
    };
    expect(shareUpdateAvailable(installed, '3.3.1')).toBe(false);
    expect(shareUpdateAvailable(installed, '3.4.0')).toBe(true);
  });

  test('targets servers, empty meaning every profile', () => {
    expect(shareMatchesServer([], 'anything')).toBe(true);
    expect(shareMatchesServer(['jartexnetwork'], 'jartexnetwork')).toBe(true);
    expect(shareMatchesServer(['jartexnetwork'], 'pikanetwork')).toBe(false);
  });

  test('accepts raster banners only', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]))).toBe('image/png');
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  test('round-trips compressed content and refuses zip bombs', () => {
    expect(unpackContent(packContent('{"a":1}'))).toBe('{"a":1}');
    expect(() => unpackContent(gzipSync(Buffer.alloc(9 * 1024 * 1024)))).toThrow('too large');
  });
});

describe('marketplace approvals', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const official = publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  const message = approvalMessage('AAAAAAAAAA', 'abcdef0123456789', 'listing-sha', 'content-sha');
  const sign = (text: string) => crypto.sign(null, Buffer.from(text), privateKey).toString('base64url');
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-approval-'));
  });

  test('accepts only an official signature over the exact revision', () => {
    const store = new PluginSecurityStore(directory, [official]);
    expect(store.verifyOfficialMessage(message, sign(message))).toBe(true);
    const otherRevision = approvalMessage('AAAAAAAAAA', 'ffffffffffffffff', 'listing-sha', 'content-sha');
    expect(store.verifyOfficialMessage(otherRevision, sign(message))).toBe(false);
    expect(new PluginSecurityStore(directory, []).verifyOfficialMessage(message, sign(message))).toBe(false);
  });

  test('a maintainer install with the official key becomes a reviewer and signs as JNbot', () => {
    const keyFile = path.join(directory, 'official.pem');
    fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const store = new PluginSecurityStore(directory, [official], [keyFile]);
    expect(store.isReviewer()).toBe(true);
    expect(store.signMessage('hello').publicKey).toBe(official);
    expect(new PluginSecurityStore(directory, [official]).isReviewer()).toBe(false);
  });
});

describe('restoring servers from the old server list', () => {
  const official = (id: string, serverId: string, canInstall = true) => ({
    id,
    kind: 'profile',
    listing: { serverId },
    publisher: { official: true },
    canInstall,
  });

  test('links old servers and local copies to official profiles, keeping legacy ones pending', async () => {
    const { bootElectron, freshUserData } = require('./helpers');
    bootElectron(freshUserData());
    const ShareService = require('../../src/main/src/functions/share/ShareService').default;
    const settings = {
      legacyServers: ['jartexnetwork', 'pikanetwork', 'donutsmp'],
      setLegacyServers: jest.fn(),
      profiles: { list: [{ id: 'mineplex' }, { id: 'hypixel', share: { id: 'X', official: true } }] },
    };
    const service = new ShareService({ settings } as any, () => {});
    jest.spyOn(service, 'marketplace').mockResolvedValue([
      official('AAAAAAAAAA', 'jartexnetwork'),
      official('BBBBBBBBBB', 'pikanetwork', false),
      { ...official('CCCCCCCCCC', 'donutsmp'), publisher: { official: false } },
      official('DDDDDDDDDD', 'mineplex'),
      official('EEEEEEEEEE', 'hypixel'),
    ]);
    const install = jest.spyOn(service, 'install').mockResolvedValue({} as any);

    await service.adoptOfficialProfiles();

    expect(install.mock.calls.map(([input]) => input.id)).toEqual(['AAAAAAAAAA', 'DDDDDDDDDD']);
    expect(settings.setLegacyServers).toHaveBeenCalledWith(['pikanetwork', 'donutsmp']);
  });
});
