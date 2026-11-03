import { EventEmitter } from 'events';
import {
  defaultKickBehaviorConfig,
  KickBehaviorOptions,
  ScriptControl,
} from '../../src/common/CommonEnums';
import BotSession from '../../src/main/src/workers/bot/BotSession';
import BotMachine from '../../src/main/src/workers/bot/statemachines/BotMachine';
import joinGamemode from '../../src/main/src/workers/bot/statemachines/joinGamemode/joinGamemodeBehaviourV3';
import {
  getKickAction,
  resolveKickAction,
} from '../../src/main/src/workers/bot/controls/kickControl';
import {
  iterateBots,
} from '../../src/main/src/workers/scripts/iterateAlts';
import workerScript from '../../src/main/src/workers/lib/workerScript';
import join from '../../src/main/src/workers/bot/join';

jest.mock('../../src/main/src/workers/bot/join', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock(
  '../../src/main/src/workers/bot/statemachines/joinGamemode/joinGamemodeBehaviourV3',
  () => ({
    __esModule: true,
    default: jest.fn(),
    gamemodeMatches: (actual: string | null | undefined, target: string) =>
      typeof actual === 'string' &&
      actual.toLowerCase().replace(/\s+/g, '').includes(target),
  }),
);

jest.mock('../../src/main/src/workers/lib/workerScript', () => {
  let controlCallback: ((control: number) => void) | undefined;
  return {
    __esModule: true,
    default: {
      onControl: jest.fn((cb) => {
        controlCallback = cb;
        return () => {
          if (controlCallback === cb) controlCallback = undefined;
        };
      }),
      setControls: jest.fn(),
      setProgress: jest.fn(),
      showSnackbarWithButtons: jest.fn(),
      stop: jest.fn(),
      send: jest.fn(),
      sendAsync: jest.fn(),
      triggerControl: (control: number) => controlCallback?.(control),
    },
  };
});

const mockedJoin = join as jest.MockedFunction<typeof join>;
const mockedJoinGamemode = joinGamemode as jest.MockedFunction<
  typeof joinGamemode
>;
const mockedWorkerScript = workerScript as jest.Mocked<
  typeof workerScript
> & { triggerControl: (control: number) => void };

function createMockBot(username: string, botId = Math.floor(Math.random() * 10000) + 1) {
  const bot = new EventEmitter() as any;
  let gamemode: string | null = 'lobby';
  bot.username = username;
  bot.botId = botId;
  bot.online = true;
  bot.isOnline = jest.fn(() => bot.online);
  bot.getGamemode = jest.fn(() => gamemode);
  bot.setGamemode = (gm: string | null) => {
    gamemode = gm;
  };
  bot.join = jest.fn(async (target: string) => {
    await mockedJoinGamemode(bot, target);
  });
  bot.end = jest.fn(() => {
    if (!bot.online) return;
    bot.online = false;
    bot.emit('end');
  });
  bot.quit = jest.fn(() => {
    bot.end();
  });
  return bot;
}

describe('Bot Lifecycle & Edge-Case Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedJoin.mockReset();
    mockedJoinGamemode.mockReset();
    global.appSettings = {
      delay_between_actions: 0,
      kickBehaviour: defaultKickBehaviorConfig,
    } as any;
    global.log = jest.fn();
    global.send = jest.fn();
  });

  describe('Alt Navigation & Skip Edge Cases', () => {
    test('skip during queued/in-flight join cleanly aborts join and advances to next alt', async () => {
      let firstJoinSignal: AbortSignal | undefined;
      const bot2 = createMockBot('second_alt', 2);

      mockedJoin
        .mockImplementationOnce((_profile: any, options: any) => {
          firstJoinSignal = options.signal;
          return new Promise((resolve) => {
            options.signal?.addEventListener('abort', () => resolve(null));
          });
        })
        .mockResolvedValueOnce(bot2);

      const iterator = iterateBots(
        [{ username: 'first_alt' }, { username: 'second_alt' }] as any,
        {},
        { filter: false },
      );

      try {
        const firstStepPromise = iterator.next();
        await new Promise((resolve) => setImmediate(resolve));

        expect(firstJoinSignal).toBeDefined();
        expect(firstJoinSignal?.aborted).toBe(false);

        // User skips the alt while join is still pending
        mockedWorkerScript.triggerControl(ScriptControl.SKIP);

        const firstYield = await firstStepPromise;
        expect(firstJoinSignal?.aborted).toBe(true);
        expect(firstYield.value.username).toBe('second_alt');
      } finally {
        await iterator.return();
      }
    });

    test('skip while bot is actively connected terminates session and yields next alt', async () => {
      const bot1 = createMockBot('online_alt1', 1);
      const bot2 = createMockBot('online_alt2', 2);

      mockedJoin
        .mockResolvedValueOnce(bot1)
        .mockResolvedValueOnce(bot2);

      const iterator = iterateBots(
        [{ username: 'online_alt1' }, { username: 'online_alt2' }] as any,
        {},
        { filter: false },
      );

      const step1 = await iterator.next();
      const yieldedBot1 = step1.value;
      expect(yieldedBot1.username).toBe('online_alt1');
      expect(bot1.isOnline()).toBe(true);

      // User skips alt while online
      mockedWorkerScript.triggerControl(ScriptControl.SKIP);

      const step2 = await iterator.next();
      expect(bot1.end).toHaveBeenCalled();
      expect(step2.value.username).toBe('online_alt2');

      await iterator.return();
    });

    test('session proxy handles property access safely after session closure', async () => {
      const bot = createMockBot('proxy_test_bot', 1);
      mockedJoin.mockResolvedValueOnce(bot);

      const iterator = iterateBots(
        [{ username: 'proxy_test_bot' }] as any,
        {},
        { filter: false },
      );

      const step = await iterator.next();
      const proxy = step.value;

      expect(proxy.username).toBe('proxy_test_bot');
      expect(proxy.isOnline?.()).toBe(true);
      expect(proxy.session).toBeDefined();

      // Close session via iterator cleanup
      await iterator.return();

      // Proxy accesses on closed session should not throw
      expect(proxy.session.closed).toBe(true);
      expect(proxy.isOnline?.()).toBeUndefined();
      expect(proxy.nonExistentProp).toBeUndefined();
      expect('session' in proxy).toBe(true);
      expect('username' in proxy).toBe(false);
    });

    test('skip on the terminal alt completes generator cleanly with done: true', async () => {
      const bot = createMockBot('last_alt', 1);
      mockedJoin.mockResolvedValueOnce(bot);

      const iterator = iterateBots(
        [{ username: 'last_alt' }] as any,
        {},
        { filter: false },
      );

      const step = await iterator.next();
      expect(step.done).toBe(false);

      mockedWorkerScript.triggerControl(ScriptControl.SKIP);
      const nextStep = await iterator.next();

      expect(nextStep.done).toBe(true);
      expect(bot.end).toHaveBeenCalled();
      expect(mockedWorkerScript.setControls).toHaveBeenLastCalledWith(
        ScriptControl.NONE,
      );
    });

    test('spammed skip commands do not exceed alt boundaries or cause duplicate transitions', async () => {
      const bot1 = createMockBot('alt_1', 1);
      const bot2 = createMockBot('alt_2', 2);
      mockedJoin
        .mockResolvedValueOnce(bot1)
        .mockResolvedValueOnce(bot2);

      const iterator = iterateBots(
        [{ username: 'alt_1' }, { username: 'alt_2' }] as any,
        {},
        { filter: false },
      );

      try {
        await iterator.next();

        // Rapidly spam SKIP 50 times
        for (let i = 0; i < 50; i++) {
          mockedWorkerScript.triggerControl(ScriptControl.SKIP);
        }

        const step2 = await iterator.next();
        expect(step2.value.username).toBe('alt_2');

        // Further spam at boundary
        for (let i = 0; i < 50; i++) {
          mockedWorkerScript.triggerControl(ScriptControl.SKIP);
        }

        const step3 = await iterator.next();
        expect(step3.done).toBe(true);
      } finally {
        await iterator.return();
      }
    });

    test('skip while paused clears pause state and advances to next alt', async () => {
      const bot1 = createMockBot('paused_alt1', 1);
      const bot2 = createMockBot('paused_alt2', 2);
      mockedJoin
        .mockResolvedValueOnce(bot1)
        .mockResolvedValueOnce(bot2);

      const iterator = iterateBots(
        [{ username: 'paused_alt1' }, { username: 'paused_alt2' }] as any,
        {},
        { filter: false },
      );

      await iterator.next();

      mockedWorkerScript.triggerControl(ScriptControl.PAUSE);
      expect(mockedWorkerScript.setControls).toHaveBeenLastCalledWith(
        ScriptControl.RESUME,
      );

      mockedWorkerScript.triggerControl(ScriptControl.SKIP);

      const step2 = await iterator.next();
      expect(step2.value.username).toBe('paused_alt2');
      await iterator.return();
    });
  });

  describe('iterateBots vs BotMachine Interaction & Ownership', () => {
    test('standalone BotMachine owns its session and closes it on stop()', async () => {
      const bot = createMockBot('standalone_bot', 1);
      mockedJoin.mockResolvedValueOnce(bot);

      const machine = new BotMachine([], {
        options: { username: 'standalone_bot' },
        delay: 0,
      });

      machine.start();
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));

      expect((machine as any).ownsSession).toBe(true);
      expect(bot.isOnline()).toBe(true);

      machine.stop();
      expect(bot.end).toHaveBeenCalled();
      expect((machine as any).session?.closed).toBe(true);
    });

    test('BotMachine with iterateBots bot does NOT own session and leaves it intact on stop()', async () => {
      const bot = createMockBot('iterated_bot', 1);
      mockedJoin.mockResolvedValueOnce(bot);

      const iterator = iterateBots(
        [{ username: 'iterated_bot' }] as any,
        {},
        { filter: false },
      );
      const step = await iterator.next();
      const iteratedBot = step.value;

      const machine = new BotMachine([], {
        bot: iteratedBot,
        delay: 0,
      });

      machine.start();
      expect((machine as any).ownsSession).toBe(false);

      machine.stop();
      // Machine stopped, but the iterator's session should remain open
      expect((machine as any).session?.closed).toBe(false);
      expect(bot.online).toBe(true);

      // Only returning iterator closes the session
      await iterator.return();
      expect(bot.end).toHaveBeenCalled();
    });

    test('BotMachine with a plain bot does not take ownership on stop()', () => {
      const plainBot = createMockBot('plain_bot', 99);
      expect(plainBot.session).toBeUndefined();

      const machine = new BotMachine([], {
        bot: plainBot,
        options: { username: 'plain_bot' },
      });

      expect((machine as any).ownsSession).toBe(false);

      machine.stop();
      expect(plainBot.session).toBeUndefined();
      expect(plainBot.end).not.toHaveBeenCalled();
    });

    test('resetOnceOnRejoin: true resets once-tasks on reconnect, false preserves completion', async () => {
      // 1. With resetOnceOnRejoin = true (default)
      const botA1 = createMockBot('bot_a', 1);
      const botA2 = createMockBot('bot_a', 2);
      let runCountA = 0;

      const sessionA = new BotSession({ profile: { username: 'bot_a' } });
      jest.spyOn(sessionA, 'open').mockResolvedValue(botA1);

      const machineA = new BotMachine(
        [
          {
            name: 'Once task A',
            once: true,
            when: () => true,
            run: () => {
              runCountA++;
            },
          },
        ],
        {
          bot: botA1,
          resetOnceOnRejoin: true,
          delay: 0,
        },
      );
      (machineA as any).session = sessionA;
      machineA.start();
      await new Promise((resolve) => setImmediate(resolve));
      expect(runCountA).toBe(1);

      // Simulate bot reconnect / adoption
      (machineA as any).adoptBot(botA2);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(runCountA).toBe(2);
      machineA.stop();

      // 2. With resetOnceOnRejoin = false
      const botB1 = createMockBot('bot_b', 3);
      const botB2 = createMockBot('bot_b', 4);
      let runCountB = 0;

      const machineB = new BotMachine(
        [
          {
            name: 'Once task B',
            once: true,
            when: () => true,
            run: () => {
              runCountB++;
            },
          },
        ],
        {
          bot: botB1,
          resetOnceOnRejoin: false,
          delay: 0,
        },
      );
      machineB.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(runCountB).toBe(1);

      // Reconnect
      (machineB as any).adoptBot(botB2);
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Should NOT run again because resetOnce was disabled
      expect(runCountB).toBe(1);
      machineB.stop();
    });

    test('state object is preserved across reconnects while gamemode join state is reset', async () => {
      const bot1 = createMockBot('state_bot', 1);
      const bot2 = createMockBot('state_bot', 2);

      const machine = new BotMachine<{ counter: number; __join_done?: boolean }>(
        [],
        {
          bot: bot1,
          state: { counter: 10, __join_done: true },
          join: { gamemode: 'prison' },
        },
      );

      expect(machine.state.counter).toBe(10);
      expect(machine.state.__join_done).toBe(true);

      // Reconnect with new bot instance
      (machine as any).adoptBot(bot2);

      // User state is preserved, internal gamemode join state is cleared
      expect(machine.state.counter).toBe(10);
      expect(machine.state.__join_done).toBeUndefined();
      expect(machine.bot).toBe(bot2);
      machine.stop();
    });

    test('gamemode join exhausts retries after 3 failed attempts and finishes machine', async () => {
      const bot = createMockBot('failing_gm_bot', 1);
      mockedJoinGamemode.mockRejectedValue(new Error('Cannot reach gamemode'));

      let finished = false;
      const machine = new BotMachine([], {
        bot,
        join: { gamemode: 'skyblock' },
        delay: 0,
      }).onFinish(() => {
        finished = true;
      });
      (machine as any).active = true;

      // Run the gamemode join task 4 times to trigger failure threshold
      const gamemodeTask = (machine as any).tasks[0];
      const context = { bot, state: machine.state, machine };

      await gamemodeTask.run(context); // relog 1
      expect((machine.state as any).__join_relogs).toBe(1);
      expect(finished).toBe(false);

      await gamemodeTask.run(context); // relog 2
      expect((machine.state as any).__join_relogs).toBe(2);
      expect(finished).toBe(false);

      await gamemodeTask.run(context); // relog 3
      expect((machine.state as any).__join_relogs).toBe(3);
      expect(finished).toBe(false);

      await gamemodeTask.run(context); // relog 4 > 3 -> terminates
      expect(finished).toBe(true);
      expect(global.log).toHaveBeenCalledWith(
        expect.stringContaining('failed to join "skyblock" gamemode after 3 relogs'),
        'error',
      );
      machine.stop();
    });
  });

  describe('Kick Behavior & Rejoin Settings Integrity', () => {
    test('getKickAction matches custom substring rules case-insensitively', () => {
      global.appSettings.kickBehaviour = {
        rules: [
          { id: '1', kickMessage: 'vpn detected', action: KickBehaviorOptions.SKIP },
          { id: '2', kickMessage: 'server restart', action: KickBehaviorOptions.RETRY },
          { id: '3', kickMessage: 'security check', action: KickBehaviorOptions.PAUSE },
        ],
        defaultAction: KickBehaviorOptions.RETRY,
      };

      expect(
        getKickAction('Kicked: VPN Detected. Please disable proxy.'),
      ).toBe('skip');
      expect(
        getKickAction('SERVER RESTART scheduled in 30 seconds'),
      ).toBe('retry');
      expect(
        getKickAction('Failed security check on login'),
      ).toBe('pause');
      expect(
        getKickAction('Unknown random kick reason'),
      ).toBe('retry');
    });

    test('getKickAction falls back to defaultKickBehaviorConfig when kickBehaviour is missing', () => {
      delete (global.appSettings as any).kickBehaviour;

      // The default config ships without rules, so everything falls through to its default action.
      expect(defaultKickBehaviorConfig.rules).toEqual([]);
      expect(defaultKickBehaviorConfig.defaultAction).toBe(KickBehaviorOptions.RETRY);
      expect(getKickAction('wrong password for account')).toBe('retry');
    });

    test('resolveKickAction prompt allows user to choose between rejoin and skip', async () => {
      const botIdentity = { username: 'test_player', botId: 42 };

      // User selects 'rejoin'
      mockedWorkerScript.showSnackbarWithButtons.mockResolvedValueOnce('rejoin');
      const decisionRejoin = await resolveKickAction(
        botIdentity,
        'Security check',
        'pause',
      );
      expect(decisionRejoin).toBe('retry');

      // User selects 'skip'
      mockedWorkerScript.showSnackbarWithButtons.mockResolvedValueOnce('skip');
      const decisionSkip = await resolveKickAction(
        botIdentity,
        'Security check',
        'pause',
      );
      expect(decisionSkip).toBe('skip');
    });

    test('reconnection preserves exact profile credentials and join options across reconnects', async () => {
      const profile = {
        username: 'FidelityBot',
        host: 'mc.hypixel.net',
        port: 25565,
        auth: 'microsoft',
        proxy: { enabled: true, url: 'socks5://user:pass@127.0.0.1:1080' },
      };
      const joinOptions = {
        login: true,
        gamemode: 'bedwars',
        joinServerTimeout: 12000,
        requiresConfirmation: true,
      };

      const bot1 = createMockBot('FidelityBot', 1);
      const bot2 = createMockBot('FidelityBot', 2);
      let capturedKickCb: ((reason: string) => void) | undefined;

      mockedJoin
        .mockImplementationOnce((_prof, opts) => {
          capturedKickCb = opts.onKick;
          return Promise.resolve(bot1);
        })
        .mockImplementationOnce((_prof, _opts) => {
          return Promise.resolve(bot2);
        });

      const session = new BotSession({ profile: profile as any, joinOptions: joinOptions as any });
      await session.open();

      expect(mockedJoin).toHaveBeenCalledTimes(1);
      expect(mockedJoin.mock.calls[0][0]).toMatchObject(profile);
      expect(mockedJoin.mock.calls[0][1]).toMatchObject(joinOptions);

      // Trigger kick with retry
      capturedKickCb?.('Connection reset by peer');
      await new Promise((resolve) => setImmediate(resolve));

      // Reconnected
      expect(mockedJoin).toHaveBeenCalledTimes(2);
      expect(mockedJoin.mock.calls[1][0]).toMatchObject(profile);
      expect(mockedJoin.mock.calls[1][1]).toMatchObject(joinOptions);
      expect(session.bot).toBe(bot2);

      session.close();
    });

    test('handles JSON and NBT formatted kick reasons without crashing', () => {
      global.appSettings.kickBehaviour = {
        rules: [
          {
            id: '1',
            kickMessage: 'You are already logged on to this server',
            action: KickBehaviorOptions.PAUSE,
          },
        ],
        defaultAction: KickBehaviorOptions.RETRY,
      };
      const jsonReason = JSON.stringify({
        text: '',
        extra: [{ text: 'You are already logged on to this server', color: 'red' }],
      });

      expect(getKickAction(jsonReason)).toBe('pause');

      // Empty or non-string reason
      expect(getKickAction('')).toBe('retry');
    });
  });
});
