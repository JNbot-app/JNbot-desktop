import { EventEmitter } from 'events';
import BotMachine from '../../src/main/src/workers/bot/statemachines/BotMachine';
import joinGamemode from '../../src/main/src/workers/bot/statemachines/joinGamemode/joinGamemodeBehaviourV3';

let mockJoinBehaviour: Record<string, unknown>;

jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: {
    getProfile: () => ({
      data: {
        joinBehaviours: {
          prison: mockJoinBehaviour,
          skyblock: mockJoinBehaviour,
        },
      },
    }),
  },
}));

jest.mock('../../src/main/src/workers/bot/BotSession', () => ({
  __esModule: true,
  default: class MockBotSession {},
}));

function createSession(bot: any) {
  return {
    bot,
    state: 'online',
    closed: false,
    subscribe(listener: (snapshot: any) => void) {
      listener({ state: 'online', bot });
      return () => {};
    },
    open: jest.fn(async () => bot),
  };
}

function createBot(
  getDetectedGamemode: () => string | null = () => null,
  onServerCommand: (gamemode: string, bot: any) => void = (_gamemode, bot) => {
    setImmediate(() => bot.emit('forcedMove'));
  },
) {
  const bot = new EventEmitter() as any;
  bot.username = 'looping_bot';
  bot.botId = 1;
  bot.currentWindow = null;
  bot.entity = null;
  bot.isOnline = jest.fn(() => true);
  bot.getGamemode = jest.fn(getDetectedGamemode);
  bot.waitForTicks = jest.fn(async () => {});
  bot.chat = jest.fn((command: string) => {
    const match = /^\/server (.+)$/.exec(command);
    if (match) onServerCommand(match[1], bot);
  });
  bot.session = createSession(bot);
  return bot;
}

describe('joining a gamemode', () => {
  beforeEach(() => {
    mockJoinBehaviour = { kind: 'command', command: '/server <gamemode>' };
    global.appSettings = { delay_between_actions: 0 } as any;
    global.log = jest.fn();
    global.send = jest.fn();
  });

  test('a confirmed transition supplies a target-specific fallback when detection is unavailable', async () => {
    const bot = createBot();

    await joinGamemode(bot, 'prison');

    expect(bot.chat).toHaveBeenCalledWith('/server prison');
    expect(bot.getGamemode()).toBe('prison');
    expect(String(bot.getGamemode() ?? '').includes('prison')).toBe(true);
    expect(bot.listenerCount('windowOpen')).toBe(0);
    expect(bot.listenerCount('forcedMove')).toBe(0);
    expect(bot.listenerCount('respawn')).toBe(0);
    expect(bot.listenerCount('error')).toBe(0);
  });

  test('the outer BotMachine guard stops after the confirmed join', async () => {
    const bot = createBot();
    bot.join = jest.fn((gamemode: string) => joinGamemode(bot, gamemode));
    let runs = 0;
    const machine = new BotMachine(
      [
        {
          name: 'Joining gamemode',
          when: ({ bot: activeBot }) =>
            !String(activeBot.getGamemode() ?? '')
              .toLowerCase()
              .includes('prison'),
          run: async ({ bot: activeBot }) => {
            runs++;
            await activeBot.join('prison');
          },
        },
      ],
      { bot, delay: 0, stopWhenIdle: true },
    );

    await new Promise<void>((resolve) => machine.onFinish(() => resolve()).start());

    expect(runs).toBe(1);
    expect(bot.join).toHaveBeenCalledTimes(1);
    expect(bot.getGamemode()).toBe('prison');
  });

  test('a real detector overrides fallback state and can confirm a new target', async () => {
    let detected: string | null = null;
    const bot = createBot(
      () => detected,
      (gamemode, activeBot) => {
        detected = gamemode;
        setImmediate(() => activeBot.emit('forcedMove'));
      },
    );

    await joinGamemode(bot, 'prison');
    expect(bot.getGamemode()).toBe('prison');

    detected = 'lobby';
    expect(bot.getGamemode()).toBe('lobby');

    await joinGamemode(bot, 'skyblock');
    expect(bot.getGamemode()).toBe('skyblock');

    detected = null;
    expect(bot.getGamemode()).toBe('skyblock');
  });

  test('unavailable detection without a success signal rejects and leaves no waits behind', async () => {
    const bot = createBot(() => null, () => {});

    await expect(joinGamemode(bot, 'prison')).rejects.toThrow(
      'could not reach prison',
    );

    expect(bot.getGamemode()).toBeNull();
    expect(bot.listenerCount('windowOpen')).toBe(0);
    expect(bot.listenerCount('forcedMove')).toBe(0);
    expect(bot.listenerCount('respawn')).toBe(0);
    expect(bot.listenerCount('end')).toBe(0);
    expect(bot.listenerCount('kicked')).toBe(0);
    expect(bot.listenerCount('error')).toBe(0);
  });

  test('direct join explicitly confirms the requested gamemode', async () => {
    mockJoinBehaviour = { kind: 'direct' };
    const bot = createBot();

    await joinGamemode(bot, 'prison');

    expect(bot.chat).not.toHaveBeenCalledWith('/server prison');
    expect(bot.getGamemode()).toBe('prison');
  });
});
