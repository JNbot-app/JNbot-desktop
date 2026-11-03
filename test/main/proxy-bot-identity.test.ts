import BotEvents from '../../src/main/src/functions/BotEvents';

describe('proxy bot identity', () => {
  test('validates a bot token from a different script event context', async () => {
    const bot = {
      botInfo: { botId: 14, username: 'Zola' },
    };
    const script = {
      profile: {
        profileKey: 'profile',
        activeScripts: { getScriptsByName: () => [{}] },
      },
      scriptHandler: {
        settings: {
          getProfile: () => ({ data: { onlineMode: true } }),
        },
      },
    };
    const activeBots = {
      profileKey: 'profile',
      getBot: () => bot,
      waitForBotJoinRequest: async () => ({ cancelled: false }),
      resolveJoinHost: () => ({ host: 'server.test', port: 25565 }),
      settings: {
        getAltsWithDataForProfile: () => [
          { username: 'Zola', email: 'zola@example.com', data: {} },
        ],
        getProfileSettings: () => ({
          scripts: { jnbotproxy: { port: 25565 } },
        }),
      },
      send: jest.fn(),
    };
    const creatorEvents = new BotEvents(
      activeBots as any,
      {} as any,
      {} as any,
    );
    const proxyEvents = new BotEvents(activeBots as any, {} as any, {} as any);
    creatorEvents.setScript(script as any);

    const join = await creatorEvents.BOT_JOIN_REQUEST({
      botId: 14,
      isPremium: true,
    });

    expect(join).toMatchObject({ granted: true, viaProxy: true });
    expect(
      proxyEvents['PROXY:VALIDATE_BOT_PROXY']({
        botId: 14,
        token: (join as any).proxyControlToken,
      }),
    ).toBe(true);
  });

  test('validates a bot token when bot was not yet indexed in activeBots during join request', async () => {
    const script = {
      instanceId: 1,
      profile: {
        profileKey: 'profile',
        activeScripts: { getScriptsByName: () => [{}] },
      },
      scriptHandler: {
        settings: {
          getProfile: () => ({ data: { onlineMode: false } }),
        },
        findBot: () => null,
      },
    };
    const creatorActiveBots = {
      profileKey: 'profile',
      getBot: () => ({ botInfo: { botId: 22, username: 'Zola' } }),
      getInstanceIdFromBot: () => 1,
      removeBot: jest.fn(),
      waitForBotJoinRequest: async () => ({ cancelled: false }),
      resolveJoinHost: () => ({ host: 'server.test', port: 25565 }),
      settings: {
        getAltsWithDataForProfile: () => [
          { username: 'Zola', email: 'zola@example.com', data: { password: 'secretpassword' } },
        ],
        getProfileSettings: () => ({
          scripts: { jnbotproxy: { port: 25565 } },
        }),
      },
      send: jest.fn(),
    };
    const creatorEvents = new BotEvents(creatorActiveBots as any, {} as any, {} as any);
    creatorEvents.setScript(script as any);

    // proxyEvents has an isolated activeBots (e.g. running in jnbotproxy profile without bot 22)
    const proxyActiveBots = {
      profileKey: 'proxy-profile',
      getBot: () => null,
      settings: {},
    };
    const proxyEvents = new BotEvents(proxyActiveBots as any, {} as any, {} as any);
    proxyEvents.setScript({ profile: { profileKey: 'proxy-profile' }, scriptHandler: { findBot: () => null } } as any);

    const join = await creatorEvents.BOT_JOIN_REQUEST({
      botId: 22,
      isPremium: false,
    });

    expect(join).toMatchObject({ granted: true, viaProxy: true });
    const token = (join as any).proxyControlToken;
    expect(typeof token).toBe('string');

    expect(
      proxyEvents['PROXY:VALIDATE_BOT_PROXY']({
        botId: 22,
        token,
      }),
    ).toBe(true);

    expect(
      proxyEvents['PROXY:VALIDATE_BOT_PROXY']({
        botId: 22,
        token: 'wrong-token',
      }),
    ).toBe(false);

    creatorEvents.BOT_LEFT({
      botId: 22,
      username: 'test',
      reason: 'quit',
      kicked: false,
    });

    expect(
      proxyEvents['PROXY:VALIDATE_BOT_PROXY']({
        botId: 22,
        token,
      }),
    ).toBe(false);
  });
});
