import { EventEmitter } from 'events';
import BotSession from '../../src/main/src/workers/bot/BotSession';
import BotMachine from '../../src/main/src/workers/bot/statemachines/BotMachine';
import joinGamemode from '../../src/main/src/workers/bot/statemachines/joinGamemode/joinGamemodeBehaviourV3';
import { iterateBots } from '../../src/main/src/workers/scripts/iterateAlts';

jest.mock('../../src/main/src/workers/bot/statemachines/joinGamemode/joinGamemodeBehaviourV3', () => ({
  __esModule: true,
  default: jest.fn(),
  gamemodeMatches: (actual: string | null | undefined, target: string) =>
    typeof actual === 'string' &&
    actual.toLowerCase().replace(/\s+/g, '').includes(target),
}));

jest.mock('../../src/main/src/workers/bot/BotSession', () => {
  class MockSession {
    static readonly instances: MockSession[] = [];
    static readonly bots: any[] = [];

    bot: any = null;
    state: 'connecting' | 'online' | 'paused' | 'closed' = 'connecting';
    readonly close = jest.fn(() => {
      if (this.state === 'closed') return;
      this.state = 'closed';
      const bot = this.bot;
      this.bot = null;
      this.emit();
      if (bot) bot.online = false;
    });
    readonly pause = jest.fn(() => {
      this.state = 'paused';
      this.emit();
    });
    readonly resume = jest.fn(() => {
      if (this.state !== 'paused') return;
      this.state = this.bot ? 'online' : 'connecting';
      this.emit();
      if (!this.bot) void this.open();
    });
    private readonly listeners = new Set<(snapshot: any) => void>();

    constructor(_options: any) {
      MockSession.instances.push(this);
    }

    get closed() {
      return this.state === 'closed';
    }

    subscribe(listener: (snapshot: any) => void) {
      this.listeners.add(listener);
      listener({ state: this.state, bot: this.bot });
      return () => this.listeners.delete(listener);
    }

    open = jest.fn(async () => {
      if (this.closed) return null;
      if (this.bot?.isOnline()) return this.bot;
      const bot = MockSession.bots.shift() ?? null;
      if (!bot) return null;
      this.bot = bot;
      this.state = 'online';
      bot.session = this;
      bot.end.mockImplementation(() => this.disconnect(bot));
      bot.quit.mockImplementation(() => this.disconnect(bot));
      this.emit();
      return bot;
    });

    private disconnect(bot: any) {
      if (this.closed || this.bot !== bot) return;
      bot.online = false;
      this.bot = null;
      this.state = 'connecting';
      this.emit();
      void Promise.resolve().then(() => this.open());
    }

    private emit() {
      const snapshot = { state: this.state, bot: this.bot };
      this.listeners.forEach((listener) => listener(snapshot));
    }
  }

  return { __esModule: true, default: MockSession };
});

jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: {
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
const MockSession = BotSession as any;

function createBot(name: string) {
  const bot = new EventEmitter() as any;
  let gamemode = 'lobby';
  bot.username = name;
  bot.botId = Math.random();
  bot.online = true;
  bot.isOnline = jest.fn(() => bot.online);
  bot.getGamemode = jest.fn(() => gamemode);
  bot.setGamemode = (next: string) => {
    gamemode = next;
  };
  bot.end = jest.fn();
  bot.quit = jest.fn();
  return bot;
}

describe('BotMachine gamemode reconnects', () => {
  beforeEach(() => {
    MockSession.instances.length = 0;
    MockSession.bots.length = 0;
    mockedJoinGamemode.mockReset();
    global.appSettings = { delay_between_actions: 0 } as any;
    global.log = jest.fn();
    global.send = jest.fn();
  });

  test('a machine without an initial bot continues on the replacement instance', async () => {
    const first = createBot('first');
    const replacement = createBot('replacement');
    MockSession.bots.push(first, replacement);
    mockedJoinGamemode
      .mockRejectedValueOnce(new Error('stuck'))
      .mockImplementationOnce(async (bot: any) => bot.setGamemode('prison'));
    let taskBot: any;

    const machine = new BotMachine(
      [
        {
          when: ({ bot }) => bot.getGamemode() === 'prison',
          run: ({ bot, machine: activeMachine }) => {
            taskBot = bot;
            activeMachine.finish();
          },
        },
      ],
      {
        options: { username: 'first' },
        join: { login: true, gamemode: 'prison' },
      },
    );

    await new Promise<void>((resolve) => machine.onFinish(() => resolve()).start());

    expect(mockedJoinGamemode.mock.calls.map(([bot]) => bot)).toEqual([
      first,
      replacement,
    ]);
    expect(first.end).toHaveBeenCalledTimes(1);
    expect(taskBot).toBe(replacement);
    expect(MockSession.instances).toHaveLength(1);
    machine.stop();
    expect(MockSession.instances[0].close).toHaveBeenCalledTimes(1);
  });

  test('a machine reuses the iterator session and leaves its cleanup to the iterator', async () => {
    const first = createBot('first');
    const replacement = createBot('replacement');
    MockSession.bots.push(first, replacement);
    mockedJoinGamemode
      .mockRejectedValueOnce(new Error('stuck'))
      .mockImplementationOnce(async (bot: any) => bot.setGamemode('prison'));
    const iterator = iterateBots(
      [{ username: 'first' }] as any,
      {},
      { filter: false },
    );
    const yielded = await iterator.next();
    const machine = new BotMachine([], {
      bot: yielded.value,
      join: { gamemode: 'prison' },
      stopWhenIdle: true,
      delay: 0,
    });

    await new Promise<void>((resolve) => machine.onFinish(() => resolve()).start());

    expect(MockSession.instances).toHaveLength(1);
    expect(mockedJoinGamemode.mock.calls.map(([bot]) => bot)).toEqual([
      first,
      replacement,
    ]);
    machine.stop();
    expect(MockSession.instances[0].close).not.toHaveBeenCalled();

    await iterator.return();
    expect(MockSession.instances[0].close).toHaveBeenCalledTimes(1);
  });
});
