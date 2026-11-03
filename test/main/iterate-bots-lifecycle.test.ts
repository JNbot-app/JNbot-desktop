import { ScriptControl } from '../../src/common/CommonEnums';
import BotSession from '../../src/main/src/workers/bot/BotSession';
import workerScript from '../../src/main/src/workers/lib/workerScript';
import {
  iterateAlts,
  iterateBots,
} from '../../src/main/src/workers/scripts/iterateAlts';

jest.mock('../../src/main/src/workers/bot/BotSession', () => {
  class MockSession {
    static readonly instances: MockSession[] = [];
    static readonly pending = new Set<string>();

    readonly username: string;
    readonly pause = jest.fn();
    readonly resume = jest.fn();
    readonly close = jest.fn();
    readonly open = jest.fn<Promise<any>, []>();
    private resolveOpen?: (bot: any) => void;
    private closed = false;

    constructor(options: any) {
      this.username = options.profile.username;
      MockSession.instances.push(this);

      if (MockSession.pending.has(this.username)) {
        this.open.mockImplementation(
          () =>
            new Promise((resolve) => {
              this.resolveOpen = resolve;
            }),
        );
      } else {
        this.open.mockResolvedValue(this.createBot());
      }

      this.close.mockImplementation(() => {
        if (this.closed) return;
        this.closed = true;
        this.resolveOpen?.(null);
      });
    }

    private createBot() {
      return {
        username: this.username,
        session: this,
        isOnline: () => !this.closed,
        end: jest.fn(),
      };
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

const mockedWorkerScript = workerScript as jest.Mocked<typeof workerScript>;
const MockSession = BotSession as any;

function controls() {
  return mockedWorkerScript.onControl.mock.calls[0][0];
}

describe('iterateBots session cursor', () => {
  beforeEach(() => {
    MockSession.instances.length = 0;
    MockSession.pending.clear();
    jest.clearAllMocks();
  });

  test('skip closes a pending session and advances', async () => {
    MockSession.pending.add('first');
    const iterator = iterateBots(
      [{ username: 'first' }, { username: 'second' }] as any,
      {},
      { filter: false },
    );
    const next = iterator.next();
    await Promise.resolve();

    controls()(ScriptControl.SKIP);

    await expect(next).resolves.toMatchObject({
      value: { username: 'second' },
    });
    expect(MockSession.instances).toHaveLength(2);
    expect(MockSession.instances[0].close).toHaveBeenCalledTimes(1);
    await iterator.return();
  });

  test('spammed navigation produces one movement', async () => {
    MockSession.pending.add('first');
    const iterator = iterateBots(
      [{ username: 'first' }, { username: 'second' }] as any,
      {},
      { filter: false },
    );
    const next = iterator.next();
    await Promise.resolve();

    controls()(ScriptControl.SKIP);
    for (let index = 0; index < 500; index++) {
      controls()(index % 2 ? ScriptControl.SKIP : ScriptControl.PREVIOUS);
    }

    await expect(next).resolves.toMatchObject({
      value: { username: 'second' },
    });
    expect(MockSession.instances).toHaveLength(2);
    expect(MockSession.instances[0].close).toHaveBeenCalledTimes(1);
    await iterator.return();
  });

  test.each([
    [ScriptControl.SKIP, 'third'],
    [ScriptControl.PREVIOUS, 'first'],
  ])(
    'navigation %s works while a later alt is queued',
    async (control, expectedUsername) => {
      MockSession.pending.add('second');
      const iterator = iterateBots(
        [
          { username: 'first' },
          { username: 'second' },
          { username: 'third' },
        ] as any,
        {},
        { filter: false },
      );
      await iterator.next();

      const queued = iterator.next();
      await Promise.resolve();
      expect(mockedWorkerScript.setControls).toHaveBeenLastCalledWith(
        ScriptControl.PAUSE | ScriptControl.SKIP | ScriptControl.PREVIOUS,
      );
      controls()(control);

      await expect(queued).resolves.toMatchObject({
        value: { username: expectedUsername },
      });
      expect(MockSession.instances[1].username).toBe('second');
      expect(MockSession.instances[1].close).toHaveBeenCalledTimes(1);
      await iterator.return();
    },
  );

  test('spammed navigation during execution still closes and moves once', async () => {
    const iterator = iterateBots(
      [
        { username: 'first' },
        { username: 'second' },
        { username: 'third' },
      ] as any,
      {},
      { filter: false },
    );
    await iterator.next();

    controls()(ScriptControl.SKIP);
    for (let index = 0; index < 500; index++) {
      controls()(index % 2 ? ScriptControl.PREVIOUS : ScriptControl.SKIP);
    }

    await expect(iterator.next()).resolves.toMatchObject({
      value: { username: 'second' },
    });
    expect(MockSession.instances).toHaveLength(2);
    expect(MockSession.instances[0].close).toHaveBeenCalledTimes(1);
    await iterator.return();
  });

  test('skip wins once while paused and does not leave a pause gate behind', async () => {
    const iterator = iterateBots(
      [{ username: 'first' }, { username: 'second' }] as any,
      {},
      { filter: false },
    );
    await iterator.next();
    const first = MockSession.instances[0];

    controls()(ScriptControl.PAUSE);
    controls()(ScriptControl.SKIP);
    for (let index = 0; index < 500; index++) {
      controls()(ScriptControl.SKIP);
    }

    await expect(iterator.next()).resolves.toMatchObject({
      value: { username: 'second' },
    });
    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(MockSession.instances).toHaveLength(2);
    await iterator.return();
  });

  test('previous moves back once and is ignored at index zero', async () => {
    const iterator = iterateBots(
      [{ username: 'first' }, { username: 'second' }] as any,
      {},
      { filter: false },
    );

    await expect(iterator.next()).resolves.toMatchObject({
      value: { username: 'first' },
    });
    controls()(ScriptControl.PREVIOUS);
    await expect(iterator.next()).resolves.toMatchObject({
      value: { username: 'second' },
    });

    controls()(ScriptControl.PREVIOUS);
    await expect(iterator.next()).resolves.toMatchObject({
      value: { username: 'first' },
    });
    expect(MockSession.instances).toHaveLength(3);
    await iterator.return();
  });

  test('pause and resume target the same session', async () => {
    const iterator = iterateBots(
      [{ username: 'first' }] as any,
      {},
      { filter: false },
    );
    await iterator.next();
    const session = MockSession.instances[0];

    controls()(ScriptControl.PAUSE);
    controls()(ScriptControl.RESUME);

    expect(session.pause).toHaveBeenCalledTimes(1);
    expect(session.resume).toHaveBeenCalledTimes(1);
    expect(MockSession.instances).toHaveLength(1);
    await iterator.return();
  });

  test.each([
    ['retry', 'first'],
    ['next', 'second'],
  ] as const)('honors the %s chain directive', async (directive, username) => {
    const iterator = iterateBots(
      [{ username: 'first' }, { username: 'second' }] as any,
      {},
      { filter: false },
    );
    await iterator.next();

    await expect(iterator.next(directive)).resolves.toMatchObject({
      value: { username },
    });
    await iterator.return();
  });

  test('a UI movement takes precedence over a chain directive', async () => {
    const iterator = iterateBots(
      [{ username: 'first' }, { username: 'second' }] as any,
      {},
      { filter: false },
    );
    await iterator.next();

    controls()(ScriptControl.SKIP);
    await expect(iterator.next('retry')).resolves.toMatchObject({
      value: { username: 'second' },
    });
    await iterator.return();
  });

  test('forEachAlt keeps Resume available at a paused boundary', async () => {
    const iterator = iterateAlts(
      [{ username: 'first' }, { username: 'second' }] as any,
      {},
      { filter: false },
    );
    await iterator.next();

    controls()(ScriptControl.PAUSE);
    const next = iterator.next();
    await Promise.resolve();

    expect(mockedWorkerScript.setControls).toHaveBeenLastCalledWith(
      ScriptControl.RESUME,
    );
    controls()(ScriptControl.RESUME);
    await expect(next).resolves.toMatchObject({
      value: { username: 'second' },
    });
    await iterator.return();
  });

  test('normal completion closes every session once', async () => {
    const iterator = iterateBots(
      [{ username: 'first' }, { username: 'second' }] as any,
      {},
      { filter: false },
    );

    await expect(iterator.next()).resolves.toMatchObject({
      value: { username: 'first' },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { username: 'second' },
    });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });

    expect(MockSession.instances).toHaveLength(2);
    for (const session of MockSession.instances) {
      expect(session.close).toHaveBeenCalledTimes(1);
    }
  });
});
