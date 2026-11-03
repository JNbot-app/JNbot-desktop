import path from 'node:path';
import {
  decodeMinecraftInvite,
  encodeMinecraftInvite,
  randomSecret,
  roomIdFromHostKey,
  secretsEqual,
} from '../../src/main/src/functions/minecraftServer/invite';
import {
  decodeTunnelFrame,
  encodeTunnelFrame,
  TUNNEL_CHUNK_BYTES,
  TunnelFrameType,
} from '../../src/main/src/functions/minecraftServer/tunnelProtocol';
import MinecraftServerManager from '../../src/main/src/functions/minecraftServer/MinecraftServerManager';
import {
  cleanupUserData,
  freshUserData,
  readJson,
} from './helpers';

afterAll(cleanupUserData);

describe('Minecraft server invites', () => {
  test('round-trips only the public invite fields', () => {
    const hostKey = randomSecret();
    const invite = {
      v: 1 as const,
      r: roomIdFromHostKey(hostKey),
      k: randomSecret(),
      n: 'Friends only',
      m: '1.21.11',
    };

    expect(decodeMinecraftInvite(encodeMinecraftInvite(invite))).toEqual(
      invite,
    );
    expect(encodeMinecraftInvite(invite)).not.toContain(hostKey);
  });

  test.each([
    '',
    'jnbot-mc:v2:e30',
    'jnbot-mc:v1:not-json',
    `jnbot-mc:v1:${Buffer.from(JSON.stringify({ v: 1, r: 'short' })).toString('base64url')}`,
  ])('rejects malformed input', (value) => {
    expect(() => decodeMinecraftInvite(value)).toThrow();
  });

  test('derives stable rooms and compares credentials safely', () => {
    const secret = randomSecret();
    expect(randomSecret()).toHaveLength(43);
    expect(roomIdFromHostKey(secret)).toBe(roomIdFromHostKey(secret));
    expect(secretsEqual(secret, secret)).toBe(true);
    expect(secretsEqual(secret, `${secret.slice(0, -1)}x`)).toBe(false);
    expect(secretsEqual(secret, 'short')).toBe(false);
  });
});

describe('Minecraft tunnel framing', () => {
  test('round-trips binary payloads and stream ids', () => {
    const payload = Buffer.from([0, 1, 2, 255]);
    const frame = decodeTunnelFrame(
      encodeTunnelFrame(TunnelFrameType.DATA, 0xfedcba98, payload),
    );

    expect(frame.type).toBe(TunnelFrameType.DATA);
    expect(frame.streamId).toBe(0xfedcba98);
    expect(frame.payload).toEqual(payload);
  });

  test('enforces frame and protocol bounds', () => {
    expect(() =>
      encodeTunnelFrame(
        TunnelFrameType.DATA,
        1,
        Buffer.alloc(TUNNEL_CHUNK_BYTES + 1),
      ),
    ).toThrow('too large');
    expect(() => decodeTunnelFrame(Buffer.alloc(5))).toThrow('Malformed');

    const wrongVersion = encodeTunnelFrame(TunnelFrameType.PING);
    wrongVersion[0] = 2;
    expect(() => decodeTunnelFrame(wrongVersion)).toThrow('Unsupported');

    const unknownType = encodeTunnelFrame(TunnelFrameType.PING);
    unknownType[1] = 255;
    expect(() => decodeTunnelFrame(unknownType)).toThrow('Unknown');
  });
});

describe('Minecraft server credential persistence', () => {
  test('stores password-free credentials and reuses them after restart', async () => {
    const directory = freshUserData();
    require('electron').__setUserDataDir(directory);
    (global as { send?: jest.Mock }).send = jest.fn();
    const bridge = { getMcBridgeServer: () => undefined };
    const first = new MinecraftServerManager(bridge as never);
    const created = await first.createDedicated({
      name: 'Private server',
      version: '1.21.11',
      eulaAccepted: true,
      memoryMB: 1024,
    });
    const invite = first.invite(created.id);
    await first.close();

    const persisted = readJson(path.join(directory, 'minecraft-servers.json'));
    expect(persisted.servers[0].hostKey).not.toMatch(/^(safe|plain):/);
    expect(persisted.servers[0].accessKey).not.toMatch(/^(safe|plain):/);

    const second = new MinecraftServerManager(bridge as never);
    expect(second.invite(created.id)).toBe(invite);
    await second.close();
  });
});
