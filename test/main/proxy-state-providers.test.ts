import { EventEmitter } from 'node:events';

const injectProxyState = require('../../src/main/src/workers/bot/botProxy');

describe('bot proxy state', () => {
  test('only exports state after a switching-proxy handshake and registers by bot id', () => {
    const client = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      protocolVersion: 774,
    });
    const bot = Object.assign(new EventEmitter(), {
      botId: 41,
      _client: client,
      entity: { id: 1, position: { x: 2, y: 64, z: 3 }, yaw: 0, pitch: 0 },
      inventory: { slots: [] },
      entities: {},
      game: { minY: -64, height: 384 },
      supportFeature: jest.fn(() => false),
      clearControlStates: jest.fn(),
    });

    injectProxyState(bot);
    expect(bot.proxyStateStatus()).toMatchObject({ ready: false });
    expect(injectProxyState.getBotStateProvider(41)).toBeUndefined();
    client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(JSON.stringify({ type: 'enable', nonce: 'nonce' })),
    });
    client.emit(
      'packet',
      { entityId: 1, viewDistance: 8 },
      { name: 'login', state: 'play' },
      undefined,
      Buffer.from([2]),
    );
    client.emit(
      'packet',
      { difficulty: 2 },
      { name: 'difficulty', state: 'play' },
      undefined,
      Buffer.from([3]),
    );

    expect(client.write).toHaveBeenCalledWith(
      'custom_payload',
      expect.objectContaining({ channel: 'jnbot:proxy' }),
    );
    expect(injectProxyState.getBotStateProvider(41)?.status()).toMatchObject({
      ready: true,
    });
    client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(
        JSON.stringify({
          type: 'state_sync',
          nonce: 'nonce',
          botId: 41,
          player: {
            position: { x: 8, y: 65, z: 9, yaw: 90, pitch: 15 },
            selectedSlot: 4,
          },
        }),
      ),
    });
    expect(bot.exportProxyState()).toMatchObject({
      protocol: 774,
      handshake: {
        configuration: [],
        login: Buffer.from([2]),
        singletons: [Buffer.from([3])],
      },
      game: { viewDistance: 8 },
      player: {
        position: { x: 8, y: 65, z: 9, yaw: 90, pitch: 15 },
        selectedSlot: 4,
      },
    });

    client.write.mockClear();
    client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(
        JSON.stringify({ type: 'barrier', nonce: 'nonce', botId: 41, id: 'b1' }),
      ),
    });
    expect(
      JSON.parse(client.write.mock.calls[0][1].data.toString()),
    ).toMatchObject({ type: 'barrier', botId: 41, id: 'b1' });
    bot.emit('end');
    expect(injectProxyState.getBotStateProvider(41)).toBeUndefined();
  });

  test('forgets the heightmaps of unloaded chunks', () => {
    const client = Object.assign(new EventEmitter(), { write: jest.fn(), protocolVersion: 774 });
    const column = { toJson: () => '{}' };
    const bot: any = Object.assign(new EventEmitter(), {
      botId: 44,
      _client: client,
      entity: { id: 1, position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 },
      inventory: { slots: [] },
      entities: {},
      game: { minY: -64, height: 384 },
      world: { getColumns: () => [{ chunkX: '1', chunkZ: '2', column }] },
      supportFeature: jest.fn(() => false),
      clearControlStates: jest.fn(),
    });
    injectProxyState(bot);
    client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(JSON.stringify({ type: 'enable', nonce: 'n' })),
    });
    client.emit('packet', {}, { name: 'login', state: 'play' }, undefined, Buffer.from([1]));
    client.emit('map_chunk', { x: 1, z: 2, heightmaps: { surface: [7] } });
    expect(bot.exportProxyState().world.chunks[0].heightmaps).toEqual({ surface: [7] });

    bot.emit('chunkColumnUnload', { x: 16, z: 32 });
    expect(bot.exportProxyState().world.chunks[0].heightmaps).toBeUndefined();
    bot.emit('end');
  });

  test('records each configuration phase as raw packets and resets it on reconfiguration', () => {
    const client = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      protocolVersion: 774,
    });
    const bot: any = Object.assign(new EventEmitter(), {
      botId: 43,
      _client: client,
      entity: { id: 1, position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 },
      inventory: { slots: [] },
      entities: {},
      game: { minY: -64, height: 384 },
      supportFeature: jest.fn((feature: string) => feature === 'hasConfigurationState'),
      clearControlStates: jest.fn(),
    });
    injectProxyState(bot);
    const emit = (name: string, state: string, raw?: number) =>
      client.emit('packet', {}, { name, state }, undefined, raw === undefined ? undefined : Buffer.from([raw]));

    emit('registry_data', 'configuration', 1);
    emit('keep_alive', 'configuration', 2);
    emit('finish_configuration', 'configuration', 3);
    emit('login', 'play', 4);
    emit('respawn', 'play', 5);
    expect(bot.proxyStateStatus().reasons ?? []).not.toContain(
      'The bot has not finished configuration',
    );

    emit('start_configuration', 'play');
    expect(bot.proxyStateStatus().reasons).toContain(
      'The bot has not finished configuration',
    );
    emit('tags', 'configuration', 6);
    emit('finish_configuration', 'configuration', 7);
    emit('login', 'play', 8);

    client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(JSON.stringify({ type: 'enable', nonce: 'n' })),
    });
    expect(bot.exportProxyState().handshake).toEqual({
      configuration: [Buffer.from([6])],
      login: Buffer.from([8]),
      respawn: undefined,
      singletons: [],
    });
    bot.emit('end');
  });

  test('keeps same-username bots isolated and ignores stale enable frames', () => {
    const makeBot = (botId: number) => {
      const client = Object.assign(new EventEmitter(), {
        write: jest.fn(),
        protocolVersion: 774,
      });
      const bot = Object.assign(new EventEmitter(), {
        botId,
        username: 'shared-name',
        _client: client,
        entity: { id: botId, position: { x: 0, y: 64, z: 0 } },
        inventory: { slots: [] },
        entities: {},
        game: { minY: -64, height: 384 },
        supportFeature: jest.fn(() => false),
      });
      injectProxyState(bot);
      client.emit('custom_payload', {
        channel: 'jnbot:proxy',
        data: Buffer.from(
          JSON.stringify({ type: 'enable', nonce: `nonce-${botId}` }),
        ),
      });
      client.emit('login', { entityId: botId, worldState: {} });
      return { bot, client };
    };

    const first = makeBot(42);
    const second = makeBot(43);
    first.client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(JSON.stringify({ type: 'enable', nonce: 'stale' })),
    });

    expect(injectProxyState.getBotStateProvider(42)).not.toBe(
      injectProxyState.getBotStateProvider(43),
    );
    const firstReady = first.client.write.mock.calls
      .map(([, packet]) => JSON.parse(packet.data.toString()))
      .find((message) => message.type === 'ready');
    expect(firstReady).toMatchObject({ nonce: 'nonce-42', botId: 42 });

    first.bot.emit('end');
    second.bot.emit('end');
  });

  test('freezes bot physics, mirrors position and head rotation correctly, and resumes with player state', () => {
    const client = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      protocolVersion: 774,
    });
    const bot = Object.assign(new EventEmitter(), {
      botId: 50,
      username: 'frozen-bot',
      _client: client,
      physicsEnabled: true,
      physics: { enabled: true },
      entity: {
        id: 50,
        position: { x: 0, y: 64, z: 0, set: jest.fn(function (x, y, z) { this.x = x; this.y = y; this.z = z; }) },
        velocity: { x: 0.1, y: -0.05, z: 0.2, set: jest.fn(function (x, y, z) { this.x = x; this.y = y; this.z = z; }) },
        yaw: 0,
        pitch: 0,
        headYaw: 0,
        onGround: false,
      },
      look: jest.fn(async () => {}),
      clearControlStates: jest.fn(),
      inventory: { slots: [] },
      entities: {},
      game: { minY: -64, height: 384 },
      supportFeature: jest.fn(() => false),
    });

    injectProxyState(bot);
    client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(JSON.stringify({ type: 'enable', nonce: 'nonce-50' })),
    });
    client.emit('login', { entityId: 50, worldState: {} });

    // 1. Bot receives freeze
    client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(
        JSON.stringify({ type: 'freeze', nonce: 'nonce-50', botId: 50 }),
      ),
    });
    expect(bot.physicsEnabled).toBe(false);
    expect(bot.physics.enabled).toBe(false);
    expect(bot.clearControlStates).toHaveBeenCalled();
    expect(bot.entity.velocity.x).toBe(0);
    expect(bot.entity.velocity.y).toBe(0);
    expect(bot.entity.velocity.z).toBe(0);

    // 2. Bot receives state_sync while frozen (yaw = 90 deg Notchian, pitch = 15 deg Notchian)
    client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(
        JSON.stringify({
          type: 'state_sync',
          nonce: 'nonce-50',
          botId: 50,
          player: {
            position: { x: 100, y: 70, z: 200, yaw: 90, pitch: 15, onGround: true },
            selectedSlot: 2,
          },
        }),
      ),
    });

    expect(bot.entity.position.x).toBe(100);
    expect(bot.entity.position.y).toBe(70);
    expect(bot.entity.position.z).toBe(200);
    expect(bot.entity.onGround).toBe(true);
    // 90 deg Notchian yaw = (PI - toRadians(90)) = PI / 2 rad
    expect(bot.entity.yaw).toBeCloseTo(Math.PI / 2, 5);
    expect(bot.entity.headYaw).toBeCloseTo(Math.PI / 2, 5);
    // 15 deg Notchian pitch = toRadians(-15) rad
    expect(bot.entity.pitch).toBeCloseTo((-15 * Math.PI) / 180, 5);
    expect(bot.look).toHaveBeenCalled();
    expect(bot.quickBarSlot).toBe(2);

    // 3. Bot receives resume with updated player position
    client.emit('custom_payload', {
      channel: 'jnbot:proxy',
      data: Buffer.from(
        JSON.stringify({
          type: 'resume',
          nonce: 'nonce-50',
          botId: 50,
          player: {
            position: { x: 120, y: 72, z: 220, yaw: 180, pitch: -30, onGround: false },
            selectedSlot: 5,
          },
        }),
      ),
    });

    expect(bot.physicsEnabled).toBe(true);
    expect(bot.physics.enabled).toBe(true);
    expect(bot.entity.position.x).toBe(120);
    expect(bot.entity.position.y).toBe(72);
    expect(bot.entity.position.z).toBe(220);
    expect(bot.entity.onGround).toBe(false);
    // 180 deg Notchian yaw = (PI - toRadians(180)) = 0 rad
    expect(bot.entity.yaw).toBeCloseTo(0, 5);
    expect(bot.entity.headYaw).toBeCloseTo(0, 5);
    // -30 deg Notchian pitch = toRadians(30) rad
    expect(bot.entity.pitch).toBeCloseTo((30 * Math.PI) / 180, 5);
    expect(bot.quickBarSlot).toBe(5);

    const resumedMsg = client.write.mock.calls
      .map(([, packet]) => JSON.parse(packet.data.toString()))
      .find((message) => message.type === 'resumed');
    expect(resumedMsg).toMatchObject({ nonce: 'nonce-50', botId: 50 });

    bot.emit('end');
  });
});
