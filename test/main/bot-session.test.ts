import { EventEmitter } from 'events';
import BotSession from '../../src/main/src/workers/bot/BotSession';
import join from '../../src/main/src/workers/bot/join';
import {
  getKickAction,
  resolveKickAction,
} from '../../src/main/src/workers/bot/controls/kickControl';

jest.mock('../../src/main/src/workers/bot/join', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../src/main/src/workers/bot/controls/kickControl', () => ({
  __esModule: true,
  getKickAction: jest.fn(() => 'retry'),
  resolveKickAction: jest.fn(async () => 'retry'),
}));

const mockedJoin = join as jest.MockedFunction<typeof join>;
const mockedGetKickAction = getKickAction as jest.MockedFunction<
  typeof getKickAction
>;
const mockedResolveKickAction = resolveKickAction as jest.MockedFunction<
  typeof resolveKickAction
>;

function createBot(username: string, id = 1) {
  const bot = new EventEmitter() as any;
  bot.username = username;
  bot.botId = id;
  bot.online = true;
  bot.isOnline = jest.fn(() => bot.online);
  bot.end = jest.fn(() => {
    bot.online = false;
  });
  return bot;
}

describe('BotSession', () => {
  beforeEach(() => {
    global.log = jest.fn();
    global.appSettings = {} as any;
    mockedJoin.mockReset();
    mockedGetKickAction.mockReset();
    mockedGetKickAction.mockReturnValue('retry');
    mockedResolveKickAction.mockReset();
    mockedResolveKickAction.mockResolvedValue('retry');
  });

  test('close aborts a pending join and is terminal', async () => {
    mockedJoin.mockImplementation(
      (_profile: any, options: any) =>
        new Promise((resolve) => {
          options.signal.addEventListener('abort', () => resolve(null));
        }),
    );
    const session = new BotSession({ profile: { username: 'first' } });
    const opening = session.open();
    await Promise.resolve();

    session.close();
    session.close();

    await expect(opening).resolves.toBeNull();
    await expect(session.open()).resolves.toBeNull();
    expect(session.state).toBe('closed');
    expect(mockedJoin).toHaveBeenCalledTimes(1);
  });

  test('overlapping open calls share one join attempt', async () => {
    let finishJoin!: (bot: any) => void;
    mockedJoin.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishJoin = resolve;
        }),
    );
    const session = new BotSession({ profile: { username: 'first' } });

    const first = session.open();
    const second = session.open();
    await Promise.resolve();
    finishJoin(createBot('first'));

    await expect(first).resolves.toMatchObject({ username: 'first' });
    await expect(second).resolves.toMatchObject({ username: 'first' });
    expect(mockedJoin).toHaveBeenCalledTimes(1);
    session.close();
  });

  test('subscriber failures do not interrupt connection or cleanup', async () => {
    const bot = createBot('first');
    mockedJoin.mockResolvedValue(bot);
    const session = new BotSession({ profile: { username: 'first' } });
    session.subscribe(() => {
      throw new Error('broken subscriber');
    });

    await expect(session.open()).resolves.toBe(bot);
    expect(() => session.close()).not.toThrow();
    expect(bot.end).toHaveBeenCalledTimes(1);
  });

  test('pause aborts joining and resume retries without overlap', async () => {
    const connected = createBot('first');
    mockedJoin
      .mockImplementationOnce(
        (_profile: any, options: any) =>
          new Promise((resolve) => {
            options.signal.addEventListener('abort', () => resolve(null));
          }),
      )
      .mockResolvedValueOnce(connected);
    const session = new BotSession({ profile: { username: 'first' } });
    const opening = session.open();
    await Promise.resolve();

    session.pause();
    await Promise.resolve();
    expect(session.state).toBe('paused');
    expect(mockedJoin).toHaveBeenCalledTimes(1);

    session.resume();
    await expect(opening).resolves.toBe(connected);
    expect(mockedJoin).toHaveBeenCalledTimes(2);
    session.close();
  });

  test('a skip kick while joining closes instead of retrying', async () => {
    mockedGetKickAction.mockReturnValue('skip');
    mockedResolveKickAction.mockResolvedValue('skip');
    mockedJoin.mockImplementation(async (_profile: any, options: any) => {
      options.onKick('wrong password');
      return null;
    });
    const session = new BotSession({ profile: { username: 'first' } });

    await expect(session.open()).resolves.toBeNull();

    expect(session.state).toBe('closed');
    expect(mockedJoin).toHaveBeenCalledTimes(1);
  });

  test('stops after repeated joins fail instead of blocking the next alt', async () => {
    mockedJoin
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(createBot('unexpected'));
    const session = new BotSession({ profile: { username: 'first' } });

    await expect(session.open()).resolves.toBeNull();

    expect(session.state).toBe('closed');
    expect(mockedJoin).toHaveBeenCalledTimes(3);
  });

  test('does not retry a failed join when login retries are disabled', async () => {
    global.appSettings = { retryOnLoginFail: false } as any;
    mockedJoin
      .mockResolvedValueOnce(null)
      .mockResolvedValue(createBot('unexpected'));
    const session = new BotSession({ profile: { username: 'first' } });

    await expect(session.open()).resolves.toBeNull();

    expect(session.state).toBe('closed');
    expect(mockedJoin).toHaveBeenCalledTimes(1);
  });

  test('an online retry kick replaces the bot once', async () => {
    const first = createBot('first', 1);
    const second = createBot('first', 2);
    const kickCallbacks: Array<(reason: string) => void> = [];
    mockedJoin
      .mockImplementationOnce(async (_profile: any, options: any) => {
        kickCallbacks.push(options.onKick);
        return first;
      })
      .mockImplementationOnce(async (_profile: any, options: any) => {
        kickCallbacks.push(options.onKick);
        return second;
      });
    const session = new BotSession({ profile: { username: 'first' } });
    const snapshots: any[] = [];
    session.subscribe((snapshot) => snapshots.push(snapshot));
    await session.open();

    kickCallbacks[0]('retry me');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockedJoin).toHaveBeenCalledTimes(2);
    expect(session.bot).toBe(second);

    kickCallbacks[0]('stale kick');
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockedJoin).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1).bot).toBe(second);
    session.close();
  });

  test('a kick at the open-promise boundary still reconnects', async () => {
    const first = createBot('first', 1);
    const second = createBot('first', 2);
    let kick!: (reason: string) => void;
    mockedJoin
      .mockImplementationOnce(async (_profile: any, options: any) => {
        kick = options.onKick;
        return first;
      })
      .mockResolvedValueOnce(second);
    const session = new BotSession({ profile: { username: 'first' } });
    let kicked = false;
    session.subscribe((snapshot) => {
      if (snapshot.state === 'online' && !kicked) {
        kicked = true;
        kick('immediate');
      }
    });

    const opened = await session.open();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockedJoin).toHaveBeenCalledTimes(2);
    expect(opened).toBe(second);
    expect(session.bot).toBe(second);
    session.close();
  });

  test('a kick reported before join settles does not expose that bot', async () => {
    const failed = createBot('first', 1);
    const connected = createBot('first', 2);
    mockedJoin
      .mockImplementationOnce(async (_profile: any, options: any) => {
        options.onKick('immediate');
        return failed;
      })
      .mockResolvedValueOnce(connected);
    const session = new BotSession({ profile: { username: 'first' } });

    await expect(session.open()).resolves.toBe(connected);

    expect(failed.end).toHaveBeenCalledTimes(1);
    expect(mockedJoin).toHaveBeenCalledTimes(2);
    session.close();
  });

  test('a paused kick waits for the decision before reconnecting', async () => {
    const first = createBot('first', 1);
    const second = createBot('first', 2);
    let decide!: (decision: 'retry') => void;
    mockedGetKickAction.mockReturnValue('pause');
    mockedResolveKickAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          decide = resolve;
        }),
    );
    let kick!: (reason: string) => void;
    mockedJoin
      .mockImplementationOnce(async (_profile: any, options: any) => {
        kick = options.onKick;
        return first;
      })
      .mockResolvedValueOnce(second);
    const session = new BotSession({ profile: { username: 'first' } });
    await session.open();

    kick('wait');
    await Promise.resolve();
    expect(session.state).toBe('paused');
    expect(mockedJoin).toHaveBeenCalledTimes(1);

    decide('retry');
    await new Promise((resolve) => setImmediate(resolve));
    expect(session.bot).toBe(second);
    expect(mockedJoin).toHaveBeenCalledTimes(2);
    session.close();
  });

  test('a kick decision wins when end is emitted before the kick callback', async () => {
    const first = createBot('first', 1);
    const unexpected = createBot('first', 2);
    let kick!: (reason: string) => void;
    mockedGetKickAction.mockReturnValue('skip');
    mockedResolveKickAction.mockResolvedValue('skip');
    mockedJoin
      .mockImplementationOnce(async (_profile: any, options: any) => {
        kick = options.onKick;
        return first;
      })
      .mockResolvedValueOnce(unexpected);
    const session = new BotSession({ profile: { username: 'first' } });
    await session.open();

    first.emit('end');
    kick('do not retry');
    await new Promise((resolve) => setImmediate(resolve));

    expect(session.state).toBe('closed');
    expect(session.bot).toBeNull();
    expect(mockedJoin).toHaveBeenCalledTimes(1);
  });
});
