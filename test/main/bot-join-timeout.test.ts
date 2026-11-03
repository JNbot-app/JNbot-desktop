import { EventEmitter } from 'events';
import { workerScriptAddress } from '../../src/common/messaging';

const sharedArray = new Uint16Array(new SharedArrayBuffer(Uint16Array.BYTES_PER_ELEMENT));

jest.mock('worker_threads', () => ({
  workerData: {
    sharedArray,
    messaging: {
      address: workerScriptAddress(1, 1),
      profileId: 1,
      scriptId: 1,
    },
    paths: {},
  },
}));

// join awaits BOT_JOINED from main; there is no main process here.
jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: {
    send: jest.fn(),
    sendAsync: jest.fn(async () => undefined),
    onMessage: jest.fn(() => () => {}),
    onceMessage: jest.fn(() => () => {}),
  },
}));

jest.mock('../../src/main/src/workers/lib/botController', () => {
  const bots: Record<number, any> = {};
  return {
    __esModule: true,
    default: {
      bots,
      registerBot: jest.fn((bot: any) => {
        bots[bot.botId] = bot;
      }),
      unregisterBot: jest.fn((botOrId: any) => {
        const id = typeof botOrId === 'number' ? botOrId : botOrId?.botId;
        delete bots[id];
      }),
      requestForBotJoin: jest.fn(async () => ({ granted: true })),
    },
  };
});

let mockCreatedBot: any = null;
jest.mock('mineflayer', () => ({
  createBot: jest.fn((options: any) => {
    const bot = new EventEmitter() as any;
    bot.username = options.username;
    bot.inventory = {};
    bot._client = new EventEmitter() as any;
    bot._client.socket = { destroy: jest.fn() };
    bot.isOnline = () => true;
    bot.end = jest.fn();
    bot.loadPlugins = jest.fn();
    mockCreatedBot = bot;
    return bot;
  }),
}));

describe('bot join timeout', () => {
  beforeEach(() => {
    mockCreatedBot = null;
    global.sharedSettings = { alts: [] } as any;
    global.appSettings = {} as any;
    global.log = jest.fn();
    global.send = jest.fn();
  });

  test('offline bot times out when connect never fires', async () => {
    const joinServer = require('../../src/main/src/workers/bot/join');
    const result = await joinServer(
      { username: 'offline_timeout_bot' },
      { joinServerTimeout: 50, retryOnLoginFail: false, joinGamemode: false, login: false },
    );
    expect(result).toBeNull();
    expect(global.log).toHaveBeenCalledWith(
      expect.stringContaining('join timeout'),
      'warning',
    );
  });

  test('microsoft bot does not time out during login before session emits', async () => {
    const joinServer = require('../../src/main/src/workers/bot/join');
    const joinPromise = joinServer(
      { username: 'ms_timeout_bot', auth: 'microsoft' },
      { joinServerTimeout: 50, retryOnLoginFail: false, joinGamemode: false, login: false },
    );

    // Wait 100ms (longer than timeout 50ms) while no session has been emitted
    await new Promise((r) => setTimeout(r, 100));
    expect(global.log).not.toHaveBeenCalledWith(
      expect.stringContaining('join timeout'),
      'warning',
    );

    // Now emit session, starting the join timeout
    mockCreatedBot._client.emit('session', { accessToken: 'token' });

    // Let the join timeout expire
    const result = await joinPromise;
    expect(result).toBeNull();
    expect(global.log).toHaveBeenCalledWith(
      expect.stringContaining('join timeout'),
      'warning',
    );
  });

  test('successful spawn clears timeout and completes join', async () => {
    const joinServer = require('../../src/main/src/workers/bot/join');
    const joinPromise = joinServer(
      { username: 'spawn_success_bot' },
      { joinServerTimeout: 100, retryOnLoginFail: false, joinGamemode: false, login: false },
    );

    // Simulate connect then spawn
    setTimeout(() => {
      mockCreatedBot.emit('connect');
      setTimeout(() => {
        mockCreatedBot.emit('spawn');
      }, 10);
    }, 10);

    const result = await joinPromise;
    expect(result).not.toBeNull();
    expect(global.log).not.toHaveBeenCalledWith(
      expect.stringContaining('join timeout'),
      'warning',
    );
  });

  test('delayed requestForBotJoin completes join without premature timeout', async () => {
    const botController = require('../../src/main/src/workers/lib/botController').default;
    botController.requestForBotJoin.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return { granted: true };
    });

    const joinServer = require('../../src/main/src/workers/bot/join');
    const joinPromise = joinServer(
      { username: 'delayed_join_request_bot' },
      { joinServerTimeout: 50, retryOnLoginFail: false, joinGamemode: false, login: false },
    );

    // Wait until requestForBotJoin finishes (60ms) and bot is created
    setTimeout(() => {
      mockCreatedBot?.emit('connect');
      mockCreatedBot?.emit('spawn');
    }, 70);

    const result = await joinPromise;
    expect(result).not.toBeNull();
    expect(global.log).not.toHaveBeenCalledWith(
      expect.stringContaining('join timeout'),
      'warning',
    );
  });
});
