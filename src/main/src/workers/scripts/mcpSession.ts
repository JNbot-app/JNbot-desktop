import workerScript from '../lib/workerScript';
import joinBot from '../bot/join';
import { Bot } from 'common/types/botApi';

type JoinRequest = {
  username: string;
  version?: string;
  login?: boolean;
  gamemode?: string;
};

export default function mcpSession(): void {
  const bots = new Map<number, Bot>();
  const joins = new Map<
    string,
    { optionsKey: string; promise: Promise<Record<string, unknown>> }
  >();

  workerScript.onMessage<JoinRequest, unknown>(
    'MCP_JOIN',
    async ({ username, version = '1.8.9', login = true, gamemode }) => {
      const key = username.trim().toLowerCase();
      const optionsKey = JSON.stringify({ version, login, gamemode: gamemode ?? null });
      const existing = joins.get(key);
      if (existing) {
        if (existing.optionsKey !== optionsKey)
          throw new Error(
            'This account already has an MCP join with different options.',
          );
        return existing.promise;
      }
      const promise = (async () => {
        const bot = (await joinBot(
          { username, version },
          { login, gamemode, joinGamemode: Boolean(gamemode) },
        )) as Bot | null;
        if (!bot) throw new Error('The bot could not connect.');
        bots.set(bot.botId, bot);
        bot.once('end', () => {
          bots.delete(bot.botId);
          joins.delete(key);
        });
        return {
          botId: bot.botId,
          username: bot.username,
          version: bot.version,
          status: 'connected',
        };
      })().catch((error) => {
        joins.delete(key);
        throw error;
      });
      joins.set(key, { optionsKey, promise });
      return promise;
    },
  );

  workerScript.onceMessage('TERMINATE', () => {
    for (const bot of bots.values()) bot.end();
    bots.clear();
    joins.clear();
  });
}
