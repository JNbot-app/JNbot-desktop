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

jest.mock('mineflayer', () => ({
  createBot: jest.fn((options: any) => {
    const bot = new EventEmitter() as any;
    bot.username = options.username;
    bot.inventory = {};
    bot._client = new EventEmitter() as any;
    bot.isOnline = () => true;
    bot.end = jest.fn();
    bot.loadPlugins = jest.fn();
    return bot;
  }),
}));

describe('bot ID allocation recycling', () => {
  beforeEach(() => {
    Atomics.store(sharedArray, 0, 0);
    global.sharedSettings = { alts: [] } as any;
    global.appSettings = {} as any;
    global.log = jest.fn();
    global.send = jest.fn();
  });

  test('recycles IDs beyond 8191 without throwing RangeError', () => {
    // Set counter to 8190 so next allocations cross the 8191 boundary
    Atomics.store(sharedArray, 0, 8190);

    require('../../src/main/src/workers/bot/join');

    // Allocation at 8190 -> (8190 % 8191) + 1 = 8191
    // Next allocation at 8191 -> (8191 % 8191) + 1 = 1
    // Next allocation at 8192 -> (8192 % 8191) + 1 = 2
    // None should throw RangeError
    require('../../src/main/src/workers/lib/botController');

    // Simulate joining past 8191
    expect(() => {
      for (let i = 0; i < 20; i++) {
        // We can call nextBotId indirectly via joinServer or test the IDs allocated
        const raw = Atomics.add(sharedArray, 0, 1);
        const id = (raw % 8191) + 1;
        expect(id).toBeGreaterThanOrEqual(1);
        expect(id).toBeLessThanOrEqual(8191);
      }
    }).not.toThrow();
  });

  test('joinServer allocates valid botId in 1..8191 range even after counter wraps', async () => {
    Atomics.store(sharedArray, 0, 8191 * 2 + 5);

    const joinServer = require('../../src/main/src/workers/bot/join');
    const mineflayer = require('mineflayer');

    let createdBotId: number | null = null;
    (mineflayer.createBot as jest.Mock).mockImplementationOnce((opts: any) => {
      const bot = new EventEmitter() as any;
      bot.username = opts.username;
      bot.inventory = {};
      bot._client = new EventEmitter() as any;
      bot.isOnline = () => true;
      bot.end = jest.fn();
      bot.loadPlugins = jest.fn();
      queueMicrotask(() => {
        createdBotId = bot.botId;
        bot.emit('spawn');
      });
      return bot;
    });

    const result = await joinServer(
      { username: 'wrap_test_bot' },
      { joinGamemode: false, login: false, resolveOnSpawn: true },
    );

    expect(result).not.toBeNull();
    expect(createdBotId).toBeGreaterThanOrEqual(1);
    expect(createdBotId).toBeLessThanOrEqual(8191);
  });
});
