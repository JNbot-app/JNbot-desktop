import ActiveBots_ from '../../src/main/src/functions/ActiveBots';
import BotMachine from '../../src/main/src/workers/bot/statemachines/BotMachine';
import BotSession from '../../src/main/src/workers/bot/BotSession';
import { EventEmitter } from 'events';

jest.mock('../../src/main/src/messaging', () => ({
  backendMessaging: {
    messenger: {
      publishToProfile: jest.fn(),
      send: jest.fn(),
      request: jest.fn(),
    },
  },
}));

jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: {
    onControl: jest.fn(() => jest.fn()),
    setControls: jest.fn(),
    setProgress: jest.fn(),
    showSnackbarWithButtons: jest.fn(),
    stop: jest.fn(),
    send: jest.fn(),
  },
}));

function createMockBot(username: string, botId: number) {
  const bot = new EventEmitter() as any;
  bot.username = username;
  bot.botId = botId;
  bot.online = true;
  bot.isOnline = jest.fn(() => bot.online);
  bot.getGamemode = jest.fn(() => null);
  bot.end = jest.fn(() => {
    bot.online = false;
    bot.emit('end');
  });
  return bot;
}

function createMockScript(
  id: string,
  runtimeProfileId: number,
  runtimeScriptId: number,
  name = 'test-plugin',
) {
  return {
    id,
    name,
    scriptId: 'plugin-test',
    pluginId: 'plugin-test',
    instanceId: runtimeScriptId,
    runtimeProfileId,
    runtimeScriptId,
    scriptHandler: {
      windowHandler: {
        v4guardCompleteUser: jest.fn(),
      },
    },
  } as any;
}

describe('Bot Owner & Script Isolation Tests', () => {
  let activeBots: ActiveBots_;
  let mockSettings: any;
  let mockScriptHandler: any;
  let mockAppSettings: any;

  beforeEach(() => {
    jest.clearAllMocks();
    global.log = jest.fn();
    global.send = jest.fn();

    mockAppSettings = {
      ip: '127.0.0.1',
      port: 25565,
      serverIpRotation: false,
      join_delay: 2000,
      join_delay_premium: 1000,
      proxy: { enabled: false, urls: [] },
    };

    mockSettings = {
      getProfileAppSettings: jest.fn(() => mockAppSettings),
      JNdata: { data: {} },
      on: jest.fn(),
    };

    mockScriptHandler = {
      publishRuntimeSummary: jest.fn(),
      getRuntime: jest.fn(() => ({ workingIps: [] })),
    };

    activeBots = new ActiveBots_(
      {} as any,
      mockSettings,
      mockScriptHandler,
      1,
      'profile-key',
    );
  });

  describe('ActiveBots Script Association & Metadata', () => {
    test('bot registration stores owning script and exports proper routing metadata', () => {
      const script = createMockScript('script-1', 1, 101, 'miner');
      const botInfo: any = {
        botId: 10,
        username: 'MinerBot',
        status: 'online',
        version: '1.8.9',
        host: 'localhost',
        port: 25565,
      };

      activeBots.addBot(botInfo, script);

      const registered = activeBots.getBot(10);
      expect(registered).toBeDefined();
      expect(registered?.script.id).toBe('script-1');
      expect(activeBots.getInstanceIdFromBot(10)).toBe(101);

      const exported = registered?.toObject();
      expect(exported).toMatchObject({
        botId: 10,
        username: 'MinerBot',
        SCRIPT_NAME: 'miner',
        INSTANCE_ID: 'script-1',
        RUNTIME_PROFILE_ID: 1,
        RUNTIME_SCRIPT_ID: 101,
      });
      expect(exported?.MESSAGE_ADDRESS).toBeDefined();
    });

    test('getInstanceIdFromBot returns null for unregistered bots', () => {
      expect(activeBots.getInstanceIdFromBot(9999)).toBeNull();
    });
  });

  describe('Cross-Script Protection', () => {
    test('updateBotStatus ignores updates coming from a script that does not own the bot', () => {
      const scriptA = createMockScript('script-A', 1, 10, 'script-A');
      const scriptB = createMockScript('script-B', 1, 20, 'script-B');

      activeBots.addBot(
        { botId: 100, username: 'BotA', status: 'online' } as any,
        scriptA,
      );

      // Script B tries to pause Bot A
      activeBots.updateBotStatus(100, 'paused', scriptB);
      expect(activeBots.getBot(100)?.botInfo.paused).toBeFalsy();

      // Script A pauses Bot A
      activeBots.updateBotStatus(100, 'paused', scriptA);
      expect(activeBots.getBot(100)?.botInfo.paused).toBe(true);

      // Script B tries to resume Bot A
      activeBots.updateBotStatus(100, 'resumed', scriptB);
      expect(activeBots.getBot(100)?.botInfo.paused).toBe(true);

      // Script A resumes Bot A
      activeBots.updateBotStatus(100, 'resumed', scriptA);
      expect(activeBots.getBot(100)?.botInfo.paused).toBe(false);
    });

    test('removeBotByScript purges only bots belonging to that script instance', () => {
      const scriptA = createMockScript('script-A', 1, 10, 'script-A');
      const scriptB = createMockScript('script-B', 1, 20, 'script-B');

      activeBots.addBot({ botId: 1, username: 'BotA1', status: 'online' } as any, scriptA);
      activeBots.addBot({ botId: 2, username: 'BotA2', status: 'online' } as any, scriptA);
      activeBots.addBot({ botId: 3, username: 'BotB1', status: 'online' } as any, scriptB);

      activeBots.removeBotByScript(scriptA);

      expect(activeBots.getBot(1)).toBeNull();
      expect(activeBots.getBot(2)).toBeNull();
      expect(activeBots.getBot(3)).toBeDefined();
      expect(activeBots.getBot(3)?.botInfo.username).toBe('BotB1');
    });

    test('cancelBotJoinRequestsByScript only cancels requests for the targeted script', async () => {
      const scriptA = createMockScript('script-A', 1, 10, 'script-A');
      const scriptB = createMockScript('script-B', 1, 20, 'script-B');

      // Grant first bot immediately
      activeBots.waitForBotJoinRequest(10, scriptA, false);

      // Queue subsequent bots
      const reqA1 = activeBots.waitForBotJoinRequest(11, scriptA, false);
      const reqB1 = activeBots.waitForBotJoinRequest(21, scriptB, false);
      const reqA2 = activeBots.waitForBotJoinRequest(12, scriptA, false);

      activeBots.cancelBotJoinRequestsByScript(scriptA);

      const resA1 = await reqA1;
      const resA2 = await reqA2;
      expect(resA1.cancelled).toBe(true);
      expect(resA2.cancelled).toBe(true);

      // Script B's request was not cancelled
      activeBots.cancelBotJoinRequest(21);
      const resB1 = await reqB1;
      expect(resB1.cancelled).toBe(true); // cancelled when explicitly asked, not by scriptA
    });
  });

  describe('BotMachine Identity & Shared Session Ownership', () => {
    test('finishing a borrowed bot leaves its connection untouched', async () => {
      const bot = createMockBot('BorrowedBot', 889);
      const run = jest.fn(({ machine }) => machine.finish());
      const machine = new BotMachine([{ when: () => true, run }], {
        bot,
        delay: 0,
      });

      await new Promise<void>((resolve) => machine.onFinish(() => resolve()).start());

      expect(run).toHaveBeenCalledTimes(1);
      expect(bot.session).toBeUndefined();
      expect(bot.listenerCount('kicked')).toBe(0);
      expect(bot.listenerCount('end')).toBe(0);
      expect(bot.end).not.toHaveBeenCalled();
      expect(bot.isOnline()).toBe(true);
    });

    test('BotMachine tracks botId across adoptions and sends status updates with active botId', () => {
      const bot1 = createMockBot('PlayerOne', 1001);
      const bot2 = createMockBot('PlayerOne', 1002);

      const machine = new BotMachine([], {
        bot: bot1,
        options: { username: 'PlayerOne' },
        delay: 0,
      });

      expect((machine as any).botId).toBe(1001);

      machine.start();
      machine.pause();
      expect(global.send).toHaveBeenCalledWith('BOT_STATUS_UPDATE', {
        botId: 1001,
        status: 'paused',
      });

      // Replacement bot adopted after reconnect
      (machine as any).adoptBot(bot2);
      expect((machine as any).botId).toBe(1002);

      machine.resume();
      expect(global.send).toHaveBeenCalledWith('BOT_STATUS_UPDATE', {
        botId: 1002,
        status: 'resumed',
      });

      machine.stop();
    });

    test('BotMachine label gracefully preserves lastBot username when bot is disconnected', () => {
      const bot = createMockBot('PersistentBot', 500);
      const machine = new BotMachine([], {
        bot,
        delay: 0,
      });

      expect((machine as any).label).toBe('PersistentBot');

      // Simulate bot disconnect (bot set to null)
      machine.bot = null;
      expect((machine as any).label).toBe('PersistentBot');

      machine.stop();
    });

    test('multiple BotMachines observing one shared session do not close it on individual stop', () => {
      const sharedBot = createMockBot('SharedBot', 888);
      const session = new BotSession({ profile: { username: 'SharedBot' } });
      (session as any).attach(sharedBot, true);

      // Both machines observe the same bot/session
      const machine1 = new BotMachine([], {
        bot: sharedBot,
        delay: 0,
      });
      const machine2 = new BotMachine([], {
        bot: sharedBot,
        delay: 0,
      });

      machine1.start();
      machine2.start();

      expect((machine1 as any).ownsSession).toBe(false);
      expect((machine2 as any).ownsSession).toBe(false);

      // Stopping machine1 should not close session or affect machine2
      machine1.stop();
      expect(session.closed).toBe(false);
      expect(machine2.active).toBe(true);

      // Stopping machine2 should still leave session open (neither machine owned it)
      machine2.stop();
      expect(session.closed).toBe(false);
      expect(sharedBot.online).toBe(true);

      // Only the true owner closing it marks it closed
      session.close();
      expect(session.closed).toBe(true);
    });
  });
});
