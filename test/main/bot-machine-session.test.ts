import { EventEmitter } from 'events';
import BotMachine from '../../src/main/src/workers/bot/statemachines/BotMachine';

jest.mock('../../src/main/src/workers/bot/BotSession', () => ({
  __esModule: true,
  default: class MockBotSession {},
}));

jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: {},
}));

function createBot(session: any) {
  const bot = new EventEmitter() as any;
  bot.username = 'first';
  bot.botId = 1;
  bot.session = session;
  bot.isOnline = jest.fn(() => true);
  bot.getGamemode = jest.fn(() => null);
  return bot;
}

class FakeSession {
  state: 'online' | 'paused' | 'closed' = 'online';
  bot: any;
  private listener?: (snapshot: any) => void;

  get closed() {
    return this.state === 'closed';
  }

  subscribe(listener: (snapshot: any) => void) {
    this.listener = listener;
    listener({ state: this.state, bot: this.bot });
    return () => {
      this.listener = undefined;
    };
  }

  open = jest.fn(async () => this.bot);

  update(state: 'online' | 'paused' | 'closed', bot = this.bot) {
    this.state = state;
    this.bot = bot;
    this.listener?.({ state, bot });
  }
}

describe('BotMachine session integration', () => {
  beforeEach(() => {
    global.appSettings = {} as any;
    global.log = jest.fn();
    global.send = jest.fn();
  });

  test('a session closed before start completes without running tasks', () => {
    const session = new FakeSession();
    const bot = createBot(session);
    session.bot = bot;
    session.state = 'closed';
    const run = jest.fn();
    const finish = jest.fn();
    const machine = new BotMachine([{ when: () => true, run }], {
      bot,
    }).onFinish(finish);

    machine.start();

    expect(machine.active).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  test('closing an active session finishes the machine once', () => {
    const session = new FakeSession();
    const bot = createBot(session);
    session.bot = bot;
    const finish = jest.fn();
    const machine = new BotMachine([], { bot }).onFinish(finish).start();

    session.update('closed', null);
    session.update('closed', null);

    expect(machine.active).toBe(false);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ bot }));
  });

  test('session pause and resume update the task runner', () => {
    const session = new FakeSession();
    const bot = createBot(session);
    session.bot = bot;
    const machine = new BotMachine([], { bot }).start();

    session.update('paused');
    expect(machine.paused).toBe(true);
    session.update('online');
    expect(machine.paused).toBe(false);
    machine.finish();
  });

  test('disableAutoReconnect finishes only the observing machine', () => {
    const session = new FakeSession();
    const bot = createBot(session);
    session.bot = bot;
    const finish = jest.fn();
    const machine = new BotMachine([], {
      bot,
      disableAutoReconnect: true,
    })
      .onFinish(finish)
      .start();

    session.update('online', null);

    expect(machine.active).toBe(false);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(session.state).toBe('online');
  });

  test('there is no server-join task in the machine clock', async () => {
    const session = new FakeSession();
    const bot = createBot(session);
    session.bot = bot;
    const finish = jest.fn();
    new BotMachine([], {
      bot,
      delay: 0,
      stopWhenIdle: true,
      debug: true,
    })
      .onFinish(finish)
      .start();

    await new Promise((resolve) => setImmediate(resolve));

    expect(finish).toHaveBeenCalledTimes(1);
    expect(global.log).not.toHaveBeenCalledWith(
      expect.stringContaining('Join server'),
      expect.anything(),
    );
  });
});
