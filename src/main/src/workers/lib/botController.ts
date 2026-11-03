import { Bot } from '../workerTypes';
import workerScript from './workerScript';

type JoinResponse = {
  granted: boolean;
  host?: string;
  port?: number;
  viaProxy?: boolean;
  onlineMode?: boolean;
  proxyUrl?: string;
  error?: string;
  cancelled?: boolean;
};

class BotController {
  bots: Record<number, Bot> = {};

  registerBot(bot: Bot) {
    this.bots[bot.botId] = bot;
  }

  unregisterBot(botOrBotId: Bot | number) {
    const botId =
      typeof botOrBotId === 'number' ? botOrBotId : botOrBotId?.botId;
    if (!botId) return;
    const bot = typeof botOrBotId === 'number' ? this.bots[botId] : botOrBotId;
    void bot?.messenger?.close();
    delete this.bots[botId];
  }

  async requestForBotJoin(
    botId: number,
    signal?: AbortSignal,
    hasProxyOverride = false,
    isPremium = false,
  ): Promise<JoinResponse> {
    if (signal?.aborted) return { granted: false, cancelled: true };

    try {
      // The join delay is deliberately unbounded; aborting this request is how
      // a skipped alt is removed from the main-process queue.
      const response = await workerScript.sendAsync<JoinResponse>(
        'BOT_JOIN_REQUEST',
        { botId, hasProxyOverride, isPremium },
        {
          signal,
          timeoutMs: 0,
        },
      );
      return response;
    } catch (error) {
      if (!signal?.aborted) throw error;
      workerScript.send('BOT_JOIN_CANCEL', { botId });
      return { granted: false, cancelled: true };
    }
  }
}

const botController = new BotController();

export default botController;
