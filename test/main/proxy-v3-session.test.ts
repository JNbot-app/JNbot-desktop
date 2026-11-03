import { EventEmitter } from 'node:events';

const listener = new EventEmitter() as EventEmitter & { close: jest.Mock };
listener.close = jest.fn();

jest.mock('minecraft-protocol', () => {
  const actual = jest.requireActual('minecraft-protocol');
  return {
    ...actual,
    createServer: jest.fn(() => listener),
    createClient: jest.fn(),
  };
});

import { createClient, states } from 'minecraft-protocol';
import ProxyServer from '../../src/main/src/workers/bot/proxyV3/ProxyServer';
import { Barriers, normalizeKeepAliveId } from '../../src/main/src/workers/bot/proxyV3/Barrier';

const CONTROL = 'jnbot:proxy';

/** A minecraft-protocol client double: echoes keep-alives, acks finish_configuration, speaks the bot channel. */
class FakeClient extends EventEmitter {
  #state: string;
  username: string;
  uuid: string;
  /** Proxy-side clients carry the protocol number here, not a version name. */
  version: string | number = 774;
  protocolVersion = 774;
  botId?: number;
  serializer = { createPacketBuffer: jest.fn(({ name }) => Buffer.from(`enc:${name}`)) };
  writeRaw = jest.fn();
  end = jest.fn((reason?: string) => this.emit('end', reason));
  supportFeature = jest.fn(() => true);
  write = jest.fn((name: string, data: any) => {
    if (name === 'keep_alive' && this.echoKeepAlive)
      queueMicrotask(() => this.send('keep_alive', { keepAliveId: data.keepAliveId }));
    if (name === 'finish_configuration' && this.#state === states.CONFIGURATION)
      queueMicrotask(() => this.send('finish_configuration', {}));
    if (name === 'custom_payload' && data.channel === CONTROL && (this.botId !== undefined || this.modSnapshot)) {
      const message = JSON.parse(data.data.toString());
      const reply = (extra: object) =>
        queueMicrotask(() =>
          this.send('custom_payload', {
            channel: CONTROL,
            data: Buffer.from(JSON.stringify({ nonce: message.nonce, botId: this.botId, ...extra })),
          }),
        );
      if (message.type === 'enable' && this.modSnapshot) reply({ type: 'ready', provider: 'inline' });
      else if (message.type === 'enable') {
        reply({ type: 'ready', token: 'token' });
        // Bots announce when their world model is complete.
        reply({ type: 'state_ready' });
      }
      if (message.type === 'barrier') reply({ type: 'barrier', id: message.id });
      if (message.type === 'capture' && this.modSnapshot) {
        // The mod streams its capture in parts that fit a serverbound payload.
        const json = JSON.stringify(this.modSnapshot);
        for (let i = 0; i < json.length; i += 40) reply({ type: 'capture_part', id: message.id, data: json.slice(i, i + 40) });
        reply({ type: 'capture_end', id: message.id });
      }
    }
  });
  echoKeepAlive = true;
  /** Set to act as a client running the JNbot mod, exporting this capture inline. */
  modSnapshot?: object;

  constructor(username: string, state: string = states.PLAY, botId?: number) {
    super();
    this.username = username;
    this.uuid = `${username}-uuid`;
    this.#state = state;
    this.botId = botId;
  }

  get state() {
    return this.#state;
  }

  set state(value: string) {
    this.#state = value;
    this.emit('state', value);
  }

  /** A packet this client sends (c2s for downstream, s2c for the upstream). */
  send(name: string, data: any, state = this.#state, raw = Buffer.from(name)) {
    this.emit('packet', data, { name, state }, raw);
  }

  controlMessages(): any[] {
    return this.write.mock.calls
      .filter(([name, data]) => name === 'custom_payload' && data.channel === CONTROL)
      .map(([, data]) => JSON.parse(data.data.toString()));
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

function snapshot() {
  return {
    protocol: 774,
    handshake: {
      configuration: [Buffer.from('cfg:registry')],
      login: Buffer.from('raw:login'),
      singletons: [Buffer.from('raw:commands')],
    },
    game: { dimension: { name: 'overworld', minY: -64, height: 384 } },
    player: {
      position: { x: 1, y: 64, z: 2, yaw: 0, pitch: 0 },
      health: 20,
      food: 20,
      foodSaturation: 5,
      experienceBar: 0,
      experienceLevel: 0,
      totalExperience: 0,
      selectedSlot: 0,
    },
    world: { chunks: [] },
    inventory: { items: [] },
  };
}

const provider = {
  status: () => ({ ready: true }),
  capture: jest.fn(async () => snapshot()),
};

/** Log a client in; like a real one it is offered the control channel once it reaches play. */
async function connect(client: FakeClient) {
  listener.emit('login', client);
  await settle();
  listener.emit('configurationLogin', client);
  // Its answer to the server's finish_configuration moves it into play.
  client.send('finish_configuration', {});
  await settle();
}

/** A proxy with one session driven by a JNbot bot, plus an upstream in play. */
async function botSession() {
  const upstream = new FakeClient('Account', states.PLAY);
  jest.mocked(createClient).mockReturnValue(upstream as any);
  const proxy = new ProxyServer({
    host: 'server.test',
    port: 25565,
    resolveBotStateProvider: () => provider,
  });
  const bot = new FakeClient('Account', states.CONFIGURATION, 7);
  await connect(bot);
  const session = [...proxy.sessions.values()][0];
  return { proxy, session, upstream, bot };
}

/** A vanilla client joining the session; it waits in configuration like a real one. */
async function joinPlayer(proxy: ProxyServer, sessionId: string, name = 'Player') {
  const player = new FakeClient(name, states.CONFIGURATION);
  const remove = proxy.onAdmission(() => ({ type: 'join', sessionId }));
  listener.emit('login', player);
  await settle();
  remove();
  listener.emit('configurationLogin', player);
  return { player, participant: proxy.getParticipant(name)! };
}

describe('proxy barriers', () => {
  test('normalizes keep-alive ids across encodings', () => {
    expect(normalizeKeepAliveId(BigInt(123456789))).toBe('123456789');
    expect(normalizeKeepAliveId(123456789)).toBe('123456789');
    expect(normalizeKeepAliveId([0, 123456789])).toBe('123456789');
    expect(normalizeKeepAliveId(undefined)).toBe('');
  });

  test('resolves on its own echo only', async () => {
    const client = new FakeClient('x');
    client.echoKeepAlive = false;
    const barriers = new Barriers();
    const done = barriers.wait({ version: 774, send: client.write }, new AbortController().signal);
    const { keepAliveId } = client.write.mock.calls[0][1];
    expect(barriers.consume(12345)).toBe(false);
    expect(barriers.consume(keepAliveId)).toBe(true);
    await expect(done).resolves.toBeUndefined();
    expect(barriers.consume(keepAliveId)).toBe(false);
  });
});

describe('proxy server sessions', () => {
  beforeEach(() => {
    listener.removeAllListeners();
    jest.clearAllMocks();
  });

  test('joins an existing session without another upstream login', async () => {
    const { proxy, session, bot } = await botSession();
    const events: string[] = [];
    proxy.on('participant', (action) => events.push(action));

    const { participant } = await joinPlayer(proxy, session.id);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(jest.mocked(createClient).mock.calls[0][0]).toMatchObject({ username: 'Account' });
    expect(events).toEqual(['attached']);
    expect(participant.role).toBe('syncing');
    expect(session.driver?.client).toBe(bot);
    expect(session.driver?.kind).toBe('bot');
    proxy.stop();
  });

  test('takes over a bot with replayed handshake bytes and hands control back', async () => {
    const { proxy, session, upstream, bot } = await botSession();
    const { player, participant } = await joinPlayer(proxy, session.id);

    const result = await session.switchTo(participant);

    expect(result).toMatchObject({ ok: true });
    expect(session.driver).toBe(participant);
    const raws = player.writeRaw.mock.calls.map(([raw]) => raw.toString());
    expect(raws.slice(0, 3)).toEqual(['cfg:registry', 'raw:login', 'raw:commands']);
    expect(player.state).toBe(states.PLAY);
    expect(bot.controlMessages().map((m) => m.type)).toEqual(
      expect.arrayContaining(['freeze', 'barrier']),
    );

    // Both receive the live stream; only the driver's input goes upstream.
    upstream.send('set_time', {});
    expect(bot.writeRaw).toHaveBeenLastCalledWith(Buffer.from('set_time'));
    expect(player.writeRaw).toHaveBeenLastCalledWith(Buffer.from('set_time'));
    bot.send('arm_animation', {});
    player.send('chat_command', {});
    expect(upstream.writeRaw.mock.calls.map(([raw]) => raw.toString())).toEqual(['chat_command']);

    player.end('bye');
    expect(session.driver?.client).toBe(bot);
    expect(bot.controlMessages().at(-1)).toMatchObject({ type: 'resume' });
    proxy.stop();
  });

  test('mirrors the driver movement and hotbar onto a frozen bot', async () => {
    const { proxy, session, bot } = await botSession();
    const { player, participant } = await joinPlayer(proxy, session.id);
    await session.switchTo(participant);
    bot.write.mockClear();

    player.send('position_look', { x: 50, y: 65, z: 80, yaw: 45, pitch: 10, onGround: true });
    player.send('held_item_slot', { slotId: 6 });

    const syncs = bot.controlMessages().filter((m) => m.type === 'state_sync');
    expect(syncs.map((m) => m.player)).toEqual([
      { position: { x: 50, y: 65, z: 80, yaw: 45, pitch: 10, onGround: true } },
      { selectedSlot: 6 },
    ]);
    proxy.stop();
  });

  test('hands a JNbot client’s connection to a bot with the client’s raw capture', async () => {
    const upstream = new FakeClient('Account', states.PLAY);
    jest.mocked(createClient).mockReturnValue(upstream as any);
    const proxy = new ProxyServer({ host: 'server.test', port: 25565 });
    const b64 = (text: string) => Buffer.from(text).toString('base64');
    const client = new FakeClient('Account', states.CONFIGURATION);
    client.modSnapshot = {
      protocol: 774,
      handshake: { configuration: [b64('cfg:registry')], login: b64('raw:login'), singletons: [] },
      bootstrap: [b64('raw:chunk'), b64('raw:inventory')],
    };
    await connect(client);
    const session = [...proxy.sessions.values()][0];
    expect(session.driver?.kind).toBe('client');

    const { player: bot, participant } = await joinPlayer(proxy, session.id, 'Bot');
    const result = await session.switchTo(participant);

    expect(result).toMatchObject({ ok: true });
    expect(session.driver).toBe(participant);
    expect(bot.writeRaw.mock.calls.map(([raw]) => raw.toString())).toEqual([
      'cfg:registry',
      'raw:login',
      'raw:chunk',
      'raw:inventory',
    ]);

    // The client now spectates and follows the bot.
    client.write.mockClear();
    bot.send('position', { x: 3, y: 70, z: 4, onGround: true });
    expect(client.controlMessages()).toEqual([
      expect.objectContaining({ type: 'state_sync', player: { position: { x: 3, y: 70, z: 4, onGround: true } } }),
    ]);

    bot.end('bye');
    expect(session.driver?.client).toBe(client);
    proxy.stop();
  });

  test('a failed takeover kicks the joiner and resumes the bot', async () => {
    const { proxy, session, bot } = await botSession();
    const { player, participant } = await joinPlayer(proxy, session.id);
    provider.capture.mockRejectedValueOnce(new Error('capture broke'));

    const result = await session.switchTo(participant);

    expect(result).toMatchObject({ ok: false, code: 'switch_failed', message: 'capture broke' });
    expect(player.end).toHaveBeenCalled();
    expect(session.driver?.client).toBe(bot);
    expect(bot.controlMessages().at(-1)).toMatchObject({ type: 'resume' });
    proxy.stop();
  });

  test('gates reconfiguration per participant until each one acknowledges it', async () => {
    const { proxy, session, upstream, bot } = await botSession();
    const { player, participant } = await joinPlayer(proxy, session.id);
    await session.switchTo(participant);
    player.writeRaw.mockClear();
    bot.writeRaw.mockClear();

    upstream.send('start_configuration', {});
    upstream.state = states.CONFIGURATION; // nmp acknowledges and switches itself
    upstream.send('registry_data', {});

    expect(player.writeRaw.mock.calls.map(([raw]) => raw.toString())).toEqual(['start_configuration']);
    player.send('configuration_acknowledged', {}, states.PLAY);
    expect(player.state).toBe(states.CONFIGURATION);
    expect(player.writeRaw.mock.calls.map(([raw]) => raw.toString())).toEqual([
      'start_configuration',
      'registry_data',
    ]);
    // The frozen bot has not acknowledged yet and still waits.
    expect(bot.writeRaw.mock.calls.map(([raw]) => raw.toString())).toEqual(['start_configuration']);
    bot.send('configuration_acknowledged', {}, states.PLAY);
    expect(bot.writeRaw).toHaveBeenLastCalledWith(Buffer.from('registry_data'));

    // The driver's replies finish the server's configuration; the bot's are kept back.
    bot.send('select_known_packs', {});
    player.send('select_known_packs', {});
    player.send('finish_configuration', {});
    expect(upstream.writeRaw.mock.calls.map(([raw]) => raw.toString())).toEqual([
      'select_known_packs',
      'finish_configuration',
    ]);
    expect(upstream.state).toBe(states.PLAY);
    expect(session.driver).toBe(participant);
    proxy.stop();
  });

  test('holds proxy-originated packets until the client acknowledged a phase change', async () => {
    const { proxy, session, upstream, bot } = await botSession();
    const driver = session.driver!;
    // The server's whole reconfiguration arrives before the client acknowledges it.
    upstream.send('start_configuration', {});
    upstream.state = states.CONFIGURATION;
    upstream.send('registry_data', {});
    upstream.send('finish_configuration', {});
    bot.send('configuration_acknowledged', {}, states.PLAY);
    expect(bot.writeRaw).toHaveBeenLastCalledWith(Buffer.from('finish_configuration'));

    // The client now decodes play packets; a configuration-encoded packet would corrupt it.
    bot.write.mockClear();
    driver.send('custom_payload', { channel: 'jnbot:proxy', data: Buffer.from('{}') });
    driver.tell('hello');
    expect(bot.write).not.toHaveBeenCalled();

    bot.send('finish_configuration', {}, states.CONFIGURATION);
    expect(bot.state).toBe(states.PLAY);
    await settle(); // chat held for play is said once the phase change resolves
    expect(bot.write.mock.calls.map(([name]) => name)).toEqual(['custom_payload', 'system_chat']);
    proxy.stop();
  });

  test('replays the next driver’s configuration replies when the driver leaves mid-configuration', async () => {
    const { proxy, session, upstream, bot } = await botSession();
    const { player, participant } = await joinPlayer(proxy, session.id);
    await session.switchTo(participant);
    upstream.send('start_configuration', {});
    upstream.state = states.CONFIGURATION;
    player.send('configuration_acknowledged', {}, states.PLAY);
    bot.send('configuration_acknowledged', {}, states.PLAY);
    upstream.send('select_known_packs', {});
    player.send('select_known_packs', {});
    bot.send('select_known_packs', {});
    upstream.send('finish_configuration', {});
    bot.send('finish_configuration', {});

    player.end('left');

    expect(upstream.writeRaw.mock.calls.map(([raw]) => raw.toString())).toEqual([
      'select_known_packs',
      'finish_configuration',
    ]);
    expect(upstream.state).toBe(states.PLAY);
    expect(session.driver?.client).toBe(bot);
    proxy.stop();
  });

  test('forwards liveness to the driver and answers it itself otherwise', async () => {
    const { proxy, session, upstream, bot } = await botSession();
    const { player, participant } = await joinPlayer(proxy, session.id);
    await session.switchTo(participant);
    upstream.write.mockClear();
    bot.write.mockClear();

    upstream.send('ping', { id: -5 });
    expect(upstream.write).not.toHaveBeenCalled();
    expect(player.writeRaw).toHaveBeenLastCalledWith(Buffer.from('ping'));
    expect(bot.writeRaw).not.toHaveBeenLastCalledWith(Buffer.from('ping'));
    bot.send('pong', { id: -5 });
    expect(upstream.write).not.toHaveBeenCalled();
    player.send('pong', { id: -5 });
    player.send('pong', { id: -5 });
    expect(upstream.write.mock.calls).toEqual([['pong', { id: -5 }]]);

    // Without a driver the proxy answers at once.
    session.handback = 'none';
    player.end('left');
    expect(session.driver).toBeUndefined();
    upstream.send('keep_alive', { keepAliveId: 99n });
    expect(upstream.write).toHaveBeenLastCalledWith('keep_alive', { keepAliveId: 99n });
    expect(session.participants.size).toBe(1);
    proxy.stop();
  });

  test('drops liveness replies owed to the previous phase', async () => {
    jest.useFakeTimers();
    try {
      const { proxy, upstream, bot } = await botSessionWithFakeTimers();
      upstream.write.mockClear();
      upstream.send('keep_alive', { keepAliveId: 5n });
      upstream.state = states.CONFIGURATION;
      jest.advanceTimersByTime(10_000);
      bot.send('keep_alive', { keepAliveId: 5n });
      expect(upstream.write).not.toHaveBeenCalledWith('keep_alive', expect.anything());
      proxy.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  test('reports a failing plugin handler and still forwards the packet', async () => {
    const { proxy, upstream, bot } = await botSession();
    const errors: any[] = [];
    proxy.on('packetError', (error) => errors.push(error));
    proxy.onPacket('set_time', () => {
      throw new Error('plugin bug');
    });

    upstream.send('set_time', { age: 1 });

    expect(errors).toEqual([
      expect.objectContaining({ name: 'set_time', direction: 's2c', code: 'handler', message: 'plugin bug' }),
    ]);
    expect(bot.writeRaw).toHaveBeenLastCalledWith(Buffer.from('set_time'));
    proxy.stop();
  });

  test('holds driver packets until the upstream finished logging in', async () => {
    const upstream = new FakeClient('Account', states.LOGIN);
    jest.mocked(createClient).mockReturnValue(upstream as any);
    const proxy = new ProxyServer({ host: 'server.test', port: 25565 });
    const player = new FakeClient('Account', states.CONFIGURATION);
    listener.emit('login', player);
    await settle();

    player.send('settings', { viewDistance: 12 });
    expect(upstream.writeRaw).not.toHaveBeenCalled();
    upstream.state = states.CONFIGURATION;
    expect(upstream.writeRaw).toHaveBeenCalledWith(Buffer.from('settings'));
    proxy.stop();
  });

  test('writes packets through the phase gate and upstream', async () => {
    const { proxy, session, upstream, bot } = await botSession();
    expect(session.write('s2c', 'system_chat', { content: 'hi' })).toBe(true);
    expect(bot.writeRaw).toHaveBeenLastCalledWith(Buffer.from('enc:system_chat'));
    expect(session.writeRaw('c2s', Uint8Array.from([1, 2]))).toBe(true);
    expect(upstream.writeRaw).toHaveBeenLastCalledWith(Buffer.from([1, 2]));
    proxy.stop();
  });

  test('ends every participant when the upstream closes', async () => {
    const { proxy, session, upstream, bot } = await botSession();
    const ended: string[] = [];
    proxy.on('session', (action) => ended.push(action));
    upstream.emit('end', 'server closed');
    expect(bot.end).toHaveBeenCalledWith('server closed');
    expect(session.isClosed).toBe(true);
    expect(ended).toEqual(['ended']);
    expect(proxy.sessions.size).toBe(0);
    proxy.stop();
  });
});

/** botSession() without real-timer settling, for fake-timer tests. */
async function botSessionWithFakeTimers() {
  const upstream = new FakeClient('Account', states.PLAY);
  jest.mocked(createClient).mockReturnValue(upstream as any);
  const proxy = new ProxyServer({ host: 'server.test', port: 25565 });
  const bot = new FakeClient('Account', states.PLAY);
  listener.emit('login', bot);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return { proxy, upstream, bot };
}
