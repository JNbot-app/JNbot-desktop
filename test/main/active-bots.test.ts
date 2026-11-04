import ActiveBots_ from '../../src/main/src/functions/ActiveBots';
import '../../src/main/src/messaging';

jest.mock('../../src/main/src/messaging', () => ({
  backendMessaging: {
    messenger: {
      publishToProfile: jest.fn(),
    },
  },
}));

describe('ActiveBots_', () => {
  let activeBots: ActiveBots_;
  let mockSettings: any;
  let mockScriptHandler: any;
  let mockAppSettings: any;

  beforeEach(() => {
    mockAppSettings = {
      ip: 'custom.server.net',
      port: 25577,
      serverIpRotation: false,
      join_delay: 2000,
      join_delay_premium: 1000,
      proxy: {
        enabled: false,
        urls: [],
      },
    };

    mockSettings = {
      getProfileAppSettings: jest.fn(() => mockAppSettings),
      JNdata: {
        data: {
          jartexnetwork: {
            defaultIp: 'play.jartex.fun',
            defaultPort: 25565,
          },
        },
      },
      on: jest.fn(),
    };

    mockScriptHandler = {
      publishRuntimeSummary: jest.fn(),
      getRuntime: jest.fn(() => ({
        workingIps: ['192.168.1.1:25565', '192.168.1.2:25565'],
      })),
    };

    activeBots = new ActiveBots_(
      {} as any,
      mockSettings,
      mockScriptHandler,
      1,
      'jartexnetwork',
    );
  });

  describe('resolveJoinHost', () => {
    it('uses configured ip and port when ip rotation is disabled', () => {
      const result = activeBots.resolveJoinHost();
      expect(result).toEqual({ host: 'custom.server.net', port: 25577 });
    });

    it('falls back to section defaultIp and defaultPort when appSettings ip is empty', () => {
      mockAppSettings.ip = '';
      delete mockAppSettings.port;

      const result = activeBots.resolveJoinHost();
      expect(result).toEqual({ host: 'play.jartex.fun', port: 25565 });
    });

    it('round-robins over workingIps when serverIpRotation is true', () => {
      mockAppSettings.serverIpRotation = true;

      const first = activeBots.resolveJoinHost();
      const second = activeBots.resolveJoinHost();
      const third = activeBots.resolveJoinHost();

      expect(first).toEqual({ host: '192.168.1.1', port: 25565 });
      expect(second).toEqual({ host: '192.168.1.2', port: 25565 });
      expect(third).toEqual({ host: '192.168.1.1', port: 25565 });
    });

    it('handles empty host strings by returning 0.0.0.0', () => {
      mockAppSettings.ip = '';
      mockSettings.JNdata.data.jartexnetwork.defaultIp = '';
      const result = activeBots.resolveJoinHost();
      expect(result.host).toBe('0.0.0.0');
    });
  });

  describe('resolveJoinProxy', () => {
    it('returns empty object when proxy is disabled', () => {
      mockAppSettings.proxy = { enabled: false, urls: [] };
      expect(activeBots.resolveJoinProxy()).toEqual({});
    });

    it('returns error when proxy is enabled but has no URLs', () => {
      mockAppSettings.proxy = { enabled: true, urls: [] };
      expect(activeBots.resolveJoinProxy()).toEqual({
        error: 'Proxy rotation is enabled but no proxies are configured.',
      });
    });

    it('round-robins through proxy URLs when enabled', () => {
      mockAppSettings.proxy = {
        enabled: true,
        urls: ['socks5://proxy1:1080', 'socks5://proxy2:1080'],
      };

      const first = activeBots.resolveJoinProxy();
      const second = activeBots.resolveJoinProxy();
      const third = activeBots.resolveJoinProxy();

      expect(first).toEqual({ proxyUrl: 'socks5://proxy1:1080' });
      expect(second).toEqual({ proxyUrl: 'socks5://proxy2:1080' });
      expect(third).toEqual({ proxyUrl: 'socks5://proxy1:1080' });
    });
  });

  describe('bot management and state updates', () => {
    const mockScript: any = {
      id: 'script-1',
      runtimeProfileId: 1,
      runtimeScriptId: 1,
    };

    it('addBot stores bot and updates status', () => {
      const botInfo: any = {
        botId: 1,
        username: 'Bot1',
        status: 'online',
      };

      activeBots.addBot(botInfo, mockScript);
      expect(activeBots.getBot(1)).toBeDefined();
      expect(activeBots.isBotActive(1)).toBe(true);
      expect(activeBots.getBotByUsername('Bot1')).toBeDefined();
      expect(activeBots.getInstanceIdFromBot(1)).toBe(1);
    });

    it('updateBotStatus pauses and resumes bot', () => {
      const botInfo: any = { botId: 2, username: 'Bot2', status: 'online' };
      activeBots.addBot(botInfo, mockScript);

      activeBots.updateBotStatus(2, 'paused', mockScript);
      expect(activeBots.getBot(2)?.botInfo.paused).toBe(true);

      activeBots.updateBotStatus(2, 'resumed', mockScript);
      expect(activeBots.getBot(2)?.botInfo.paused).toBe(false);
    });

    it('updateBotStatus ignores updates from mismatched script', () => {
      const botInfo: any = { botId: 3, username: 'Bot3', status: 'online' };
      activeBots.addBot(botInfo, mockScript);

      const wrongScript: any = {
        id: 'wrong-script',
        runtimeProfileId: 1,
        runtimeScriptId: 2,
      };
      activeBots.updateBotStatus(3, 'paused', wrongScript);
      expect(activeBots.getBot(3)?.botInfo.paused).toBeFalsy();
    });

    it('removeBot removes bot and emits bot-ended', () => {
      const botEndedSpy = jest.fn();
      activeBots.on('bot-ended', botEndedSpy);

      const botInfo: any = { botId: 4, username: 'Bot4', status: 'online' };
      activeBots.addBot(botInfo, mockScript);
      activeBots.removeBot({ botId: 4 });

      expect(activeBots.getBot(4)).toBeNull();
      expect(botEndedSpy).toHaveBeenCalled();
    });

    it('removeBotByScript removes all bots owned by that script', () => {
      const scriptA: any = { id: 's-A', runtimeProfileId: 1, runtimeScriptId: 10 };
      const scriptB: any = { id: 's-B', runtimeProfileId: 1, runtimeScriptId: 11 };

      activeBots.addBot({ botId: 10, username: 'A1', status: 'online' } as any, scriptA);
      activeBots.addBot({ botId: 11, username: 'A2', status: 'online' } as any, scriptA);
      activeBots.addBot({ botId: 12, username: 'B1', status: 'online' } as any, scriptB);

      activeBots.removeBotByScript(scriptA);

      expect(activeBots.getBot(10)).toBeNull();
      expect(activeBots.getBot(11)).toBeNull();
      expect(activeBots.getBot(12)).toBeDefined();
    });
  });

  describe('minecraft bot integration', () => {
    it('upserts and removes Minecraft bots with negative IDs', () => {
      activeBots.upsertMinecraftBot({
        clientId: 'client-abc',
        username: 'SteveMC',
        status: 'online',
      });

      const bots = activeBots.toArray();
      const mcBot = bots.find((b: any) => b.username === 'SteveMC');
      expect(mcBot).toBeDefined();
      expect(mcBot.botId).toBeLessThan(0);
      expect(mcBot.origin).toBe('minecraft');

      activeBots.removeMinecraftBot('client-abc');
      const updated = activeBots.toArray();
      expect(updated.find((b: any) => b.username === 'SteveMC')).toBeUndefined();
    });
  });

  describe('join queue scheduling', () => {
    it('cancels join requests cleanly', async () => {
      const script: any = { id: 's-queue', runtimeProfileId: 1, runtimeScriptId: 1 };
      // First bot is granted immediately
      const firstJoin = activeBots.waitForBotJoinRequest(98, script, false);
      // Second bot waits for join delay
      const secondJoin = activeBots.waitForBotJoinRequest(99, script, false);

      activeBots.cancelBotJoinRequest(99);
      const resFirst = await firstJoin;
      const resSecond = await secondJoin;
      expect(resFirst).toEqual({ cancelled: false });
      expect(resSecond).toEqual({ cancelled: true });
    });

    it('cancels join requests by script', async () => {
      const script: any = { id: 's-cancel-all', runtimeProfileId: 1, runtimeScriptId: 1 };
      // First bot granted immediately
      activeBots.waitForBotJoinRequest(100, script, false);
      // Next bots queued
      const join1 = activeBots.waitForBotJoinRequest(101, script, false);
      const join2 = activeBots.waitForBotJoinRequest(102, script, false);

      activeBots.cancelBotJoinRequestsByScript(script);

      const res1 = await join1;
      const res2 = await join2;
      expect(res1.cancelled).toBe(true);
      expect(res2.cancelled).toBe(true);
    });
  });
});
