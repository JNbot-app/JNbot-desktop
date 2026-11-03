import { EventEmitter } from 'events';
import BotSession from '../../src/main/src/workers/bot/BotSession';
import BotMachine from '../../src/main/src/workers/bot/statemachines/BotMachine';
import joinGamemode from '../../src/main/src/workers/bot/statemachines/joinGamemode/joinGamemodeBehaviourV3';
import { iterateBots } from '../../src/main/src/workers/scripts/iterateAlts';

jest.mock(
  '../../src/main/src/workers/bot/statemachines/joinGamemode/joinGamemodeBehaviourV3',
  () => {
    const original = jest.requireActual(
      '../../src/main/src/workers/bot/statemachines/joinGamemode/joinGamemodeBehaviourV3',
    );
    return {
      __esModule: true,
      default: jest.fn(),
      gamemodeMatches: original.gamemodeMatches,
      createJoinTasks: original.createJoinTasks,
      runJoinCleanup: original.runJoinCleanup,
    };
  },
);

jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: {
    workerData: { appVersion: '1.0.0' },
    onControl: jest.fn(() => jest.fn()),
    setControls: jest.fn(),
    setProgress: jest.fn(),
    showSnackbarWithButtons: jest.fn(),
    stop: jest.fn(),
  },
}));

const mockedJoinGamemode = joinGamemode as jest.MockedFunction<
  typeof joinGamemode
>;

function createMockBot(name: string) {
  const bot = new EventEmitter() as any;
  let gamemode: string | null = null;
  bot.username = name;
  bot.botId = Math.random();
  bot.online = true;
  bot.isOnline = jest.fn(() => bot.online);
  bot.getGamemode = jest.fn(() => gamemode);
  bot.setGamemode = (next: string | null) => {
    gamemode = next;
  };
  bot.join = jest.fn((target: string) => mockedJoinGamemode(bot, target));
  bot.end = jest.fn(() => {
    bot.online = false;
    bot.emit('end');
  });
  bot.quit = jest.fn(() => {
    bot.online = false;
    bot.emit('end');
  });
  return bot;
}

describe('BotMachine gamemode join reconnect loop resolution', () => {
  beforeEach(() => {
    mockedJoinGamemode.mockReset();
    global.appSettings = { delay_between_actions: 0 } as any;
    global.log = jest.fn();
    global.send = jest.fn();
  });

  test('iterateBots handles reconnection and prevents infinite loop when user task closes over bot variable', async () => {
    const firstBot = createMockBot('first_bot');
    const secondBot = createMockBot('second_bot');

    let openCallCount = 0;
    jest.spyOn(BotSession.prototype, 'open').mockImplementation(async function (
      this: BotSession,
    ) {
      openCallCount++;
      const bot = openCallCount === 1 ? firstBot : secondBot;
      (this as any).attach(bot, false);
      return (this as any).proxy ?? bot;
    });

    const iterator = iterateBots(
      [{ username: 'test_alt' }] as any,
      {},
      { filter: false },
    );

    const step = await iterator.next();
    const bot = step.value;

    // First attempt on firstBot fails, second attempt on secondBot succeeds
    mockedJoinGamemode.mockImplementation(async (targetBot: any, target: string) => {
      if (targetBot === firstBot || (targetBot.session?.bot === firstBot)) {
        throw new Error('firstBot could not reach prison.');
      }
      secondBot.setGamemode(target);
    });

    let joinAttempts = 0;
    let finishReached = false;

    const normalizeGamemode = (g: any) => String(g ?? '').toLowerCase();

    const machine = new BotMachine(
      [
        {
          name: 'Joining gamemode',
          // Notice: user code captures `bot` in closure
          when: () => !normalizeGamemode(bot.getGamemode()).includes('prison'),
          run: async ({ bot: activeBot }) => {
            joinAttempts++;
            await activeBot.join('prison').catch((err) => {
              // Bot failed to join, quit to trigger reconnect
              activeBot.quit();
            });
          },
        },
        {
          name: 'Post join task',
          when: () => normalizeGamemode(bot.getGamemode()).includes('prison'),
          run: ({ machine: m }) => {
            finishReached = true;
            m.finish();
          },
        },
      ],
      {
        bot,
        delay: 0,
        stopWhenIdle: true,
      },
    );

    await new Promise<void>((resolve) => machine.onFinish(() => resolve()).start());

    // Joining gamemode task should run twice (once on firstBot which failed, once on secondBot which succeeded)
    expect(joinAttempts).toBe(2);
    expect(finishReached).toBe(true);
    expect(normalizeGamemode(bot.getGamemode())).toBe('prison');

    await iterator.return();
  });

  test('BotMachine without initial bot joins, reconnects on failure, and finishes', async () => {
    const firstBot = createMockBot('first_bot');
    const secondBot = createMockBot('second_bot');

    let openCount = 0;
    jest.spyOn(BotSession.prototype, 'open').mockImplementation(async function (
      this: BotSession,
    ) {
      openCount++;
      const bot = openCount === 1 ? firstBot : secondBot;
      (this as any).attach(bot, false);
      return (this as any).proxy ?? bot;
    });

    mockedJoinGamemode.mockImplementation(async (targetBot: any, target: string) => {
      if (targetBot === firstBot || targetBot.session?.bot === firstBot) {
        throw new Error('stuck');
      }
      secondBot.setGamemode(target);
    });

    let attempts = 0;
    let postJoinRan = false;

    const machine = new BotMachine(
      [
        {
          name: 'Joining gamemode',
          when: ({ bot }) => !String(bot?.getGamemode() ?? '').includes('prison'),
          run: async ({ bot }) => {
            attempts++;
            await bot.join('prison').catch(() => {
              bot.quit();
            });
          },
        },
        {
          name: 'Do work in prison',
          when: ({ bot }) => String(bot?.getGamemode() ?? '').includes('prison'),
          run: ({ machine: m }) => {
            postJoinRan = true;
            m.finish();
          },
        },
      ],
      {
        options: { username: 'test_user' },
        join: { login: true },
        delay: 0,
        stopWhenIdle: true,
      },
    );

    await new Promise<void>((resolve) => machine.onFinish(() => resolve()).start());

    expect(attempts).toBe(2);
    expect(postJoinRan).toBe(true);
    machine.stop();
  });

  test('user script iterating over multiple gamemodes transitions properly across reconnects', async () => {
    const firstBot = createMockBot('first_bot');
    const secondBot = createMockBot('second_bot');
    const gamemodes = ['prison', 'skyblock'];

    let openCount = 0;
    jest.spyOn(BotSession.prototype, 'open').mockImplementation(async function (
      this: BotSession,
    ) {
      openCount++;
      const bot = openCount === 1 ? firstBot : secondBot;
      (this as any).attach(bot, false);
      return (this as any).proxy ?? bot;
    });

    mockedJoinGamemode.mockImplementation(async (targetBot: any, target: string) => {
      // First attempt on firstBot for prison fails
      if (target === 'prison' && (targetBot === firstBot || targetBot.session?.bot === firstBot)) {
        throw new Error('stuck in prison login');
      }
      secondBot.setGamemode(target);
    });

    const iterator = iterateBots(
      [{ username: 'multi_gm_bot' }] as any,
      {},
      { filter: false },
    );
    const step = await iterator.next();
    const bot = step.value;

    const visited: string[] = [];

    const machine = new BotMachine<{ gamemodeCounter: number }>(
      [
        {
          name: 'Joining gamemode',
          when: ({ state }) =>
            state.gamemodeCounter < gamemodes.length &&
            bot.getGamemode() !== gamemodes[state.gamemodeCounter],
          run: async ({ bot: activeBot, state }) => {
            const target = gamemodes[state.gamemodeCounter];
            await activeBot.join(target).catch(() => {
              activeBot.quit();
            });
          },
        },
        {
          name: 'Process gamemode',
          when: ({ state }) =>
            state.gamemodeCounter < gamemodes.length &&
            bot.getGamemode() === gamemodes[state.gamemodeCounter],
          run: ({ state }) => {
            visited.push(gamemodes[state.gamemodeCounter]);
            state.gamemodeCounter++;
          },
        },
      ],
      {
        bot,
        state: { gamemodeCounter: 0 },
        delay: 0,
        stopWhenIdle: true,
      },
    );

    await new Promise<void>((resolve) => machine.onFinish(() => resolve()).start());

    expect(visited).toEqual(['prison', 'skyblock']);
    await iterator.return();
  });
});

