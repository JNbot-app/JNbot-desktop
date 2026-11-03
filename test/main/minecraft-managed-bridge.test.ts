import net from 'node:net';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import JnbotMcBridgeServer from '../../src/main/src/functions/minecraft/bridge/JnbotMcBridgeServer';
import ManagedMinecraftServerBridge from '../../src/main/src/functions/minecraftServer/ManagedMinecraftServerBridge';

jest.mock('../../src/main/src/functions/minecraft/launcher/JnbotMods', () => ({
  isJnbotModAvailable: (version: string) => version === '1.21.11',
}));

const protocol = 1;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });

const nextMessage = (socket: WebSocket) =>
  new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for WebSocket message')),
      2_000,
    );
    socket.once('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });

const nextClose = (socket: WebSocket) =>
  new Promise<number>((resolve) => {
    socket.once('close', (code) => resolve(code));
  });

describe('managed Minecraft bridge endpoints', () => {
  let bridge: JnbotMcBridgeServer;
  let url: string;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    const port = await freePort();
    url = `ws://127.0.0.1:${port}`;
    bridge = new JnbotMcBridgeServer({ port });
    bridge.start();
  });

  afterEach(() => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    bridge?.stop();
  });

  test('keeps legacy client hellos backward compatible', async () => {
    const socket = await open(url);
    sockets.push(socket);
    const reply = nextMessage(socket);
    socket.send(
      JSON.stringify({
        v: protocol,
        type: 'hello',
        clientId: 'legacy-client',
        username: 'Steve',
      }),
    );

    expect(await reply).toMatchObject({ type: 'helloAck' });
    expect(bridge.listClients()).toEqual([
      expect.objectContaining({
        clientId: 'legacy-client',
        username: 'Steve',
      }),
    ]);
  });

  test('authenticates managed servers and rejects spoofed ids', async () => {
    bridge.registerManagedServer('managed-1', 'secret-token');
    const managed = await open(url);
    sockets.push(managed);
    const ack = nextMessage(managed);
    managed.send(
      JSON.stringify({
        v: protocol,
        type: 'hello',
        kind: 'managed-server',
        serverId: 'managed-1',
        token: 'secret-token',
        mcVersion: '1.21.11',
        modVersion: '0.1.1',
      }),
    );
    expect(await ack).toMatchObject({ type: 'helloAck' });
    expect(bridge.listManagedServers()).toEqual([
      expect.objectContaining({
        serverId: 'managed-1',
        mcVersion: '1.21.11',
      }),
    ]);

    const spoofed = await open(url);
    sockets.push(spoofed);
    const rejection = nextMessage(spoofed);
    const closed = nextClose(spoofed);
    spoofed.send(
      JSON.stringify({
        v: protocol,
        type: 'hello',
        kind: 'managed-server',
        serverId: 'managed-1',
        token: 'wrong-token',
      }),
    );
    expect(await rejection).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
    expect(await closed).toBe(1008);
  });

  test('routes requests, times out, and revokes runtime tokens', async () => {
    bridge.registerManagedServer('managed-1', 'secret-token');
    const managed = await open(url);
    sockets.push(managed);
    const ack = nextMessage(managed);
    managed.send(
      JSON.stringify({
        v: protocol,
        type: 'hello',
        kind: 'managed-server',
        serverId: 'managed-1',
        token: 'secret-token',
      }),
    );
    await ack;

    managed.once('message', (data) => {
      const request = JSON.parse(data.toString());
      managed.send(
        JSON.stringify({
          v: protocol,
          type: 'response',
          id: request.id,
          ok: true,
          result: { players: 2 },
        }),
      );
    });
    await expect(
      bridge.sendManagedServerRequest('managed-1', 'server.players.list'),
    ).resolves.toEqual({ players: 2 });

    await expect(
      bridge.sendManagedServerRequest(
        'managed-1',
        'server.never.responds',
        undefined,
        { timeoutMs: 20 },
      ),
    ).rejects.toMatchObject({ code: 'timeout' });

    const closed = nextClose(managed);
    bridge.revokeManagedServer('managed-1');
    expect(await closed).toBe(1008);
    await expect(
      bridge.sendManagedServerRequest('managed-1', 'server.status'),
    ).rejects.toMatchObject({ code: 'api_unavailable' });

    const replay = await open(url);
    sockets.push(replay);
    const rejected = nextMessage(replay);
    replay.send(
      JSON.stringify({
        v: protocol,
        type: 'hello',
        kind: 'managed-server',
        serverId: 'managed-1',
        token: 'secret-token',
      }),
    );
    expect(await rejected).toMatchObject({
      error: { code: 'unauthorized' },
    });
  });
});

describe('managed server event aggregation', () => {
  test('does not start the bridge for read-only connection checks', () => {
    const ensureMcBridgeServer = jest.fn();
    const clientBridge = {
      ensureMcBridgeServer,
      getMcBridgeServer: jest.fn(() => null),
    } as any;
    const managed = new ManagedMinecraftServerBridge(
      clientBridge,
      () => undefined,
      jest.fn(),
    );

    expect(managed.isConnected('server-1')).toBe(false);
    expect(managed.apiVersion('server-1')).toBeUndefined();
    expect(managed.list()).toEqual([]);
    expect(ensureMcBridgeServer).not.toHaveBeenCalled();
  });

  test('subscribes once and cleans up when the final script exits', () => {
    const hub = new EventEmitter() as any;
    hub.listManagedServers = jest.fn(() => [
      { serverId: 'server-1', modVersion: '0.1.1' },
    ]);
    hub.sendManagedServerRequest = jest.fn(async () => undefined);
    const clientBridge = {
      ensureMcBridgeServer: () => hub,
      scheduleIdleStop: jest.fn(),
    } as any;
    const summary = {
      id: 'server-1',
      name: 'Test',
      version: '1.21.11',
      role: 'host',
      source: 'dedicated',
      state: 'online',
      peerCount: 0,
      createdAt: 1,
      apiState: 'online',
      restartRequired: false,
      pluginCount: 0,
    } as const;
    const managed = new ManagedMinecraftServerBridge(
      clientBridge,
      () => summary,
      jest.fn(),
    );
    const first = { instanceId: 1, send: jest.fn() } as any;
    const second = { instanceId: 2, send: jest.fn() } as any;

    managed.subscribe(first, 'server-1', 'chat');
    managed.subscribe(second, 'server-1', 'chat');
    expect(hub.sendManagedServerRequest).toHaveBeenCalledTimes(1);
    expect(hub.sendManagedServerRequest).toHaveBeenLastCalledWith(
      'server-1',
      'server.events.subscribe',
      { event: 'server.chat' },
      expect.anything(),
    );

    managed.unsubscribeAll(first.instanceId);
    expect(hub.sendManagedServerRequest).toHaveBeenCalledTimes(1);
    managed.unsubscribeAll(second.instanceId);
    expect(hub.sendManagedServerRequest).toHaveBeenCalledTimes(2);
    expect(hub.sendManagedServerRequest).toHaveBeenLastCalledWith(
      'server-1',
      'server.events.unsubscribe',
      { event: 'server.chat' },
      expect.anything(),
    );
  });
});
