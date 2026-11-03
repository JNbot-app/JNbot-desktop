import type {
  BotAction,
  BotActionArgs,
  BotActionReturns,
} from '../../main/src/workers/workerTypes';

import useSettingsStore from '../redux/store';

export type EventCallback = (data: any) => void;
export type UnsubscribeFunction = () => void;

class BotEventsClient {
  subscribe(
    botId: number,
    eventType: string,
    callback: EventCallback,
    options?: {
      throttle?: number /* in ms */;
      ignorePrevious?: boolean /* When throttling, ingore prev positions, so we only send the latest, newest packet*/;
    },
  ): UnsubscribeFunction {
    const activeBots = useSettingsStore.getState().activeBots;
    const bot = activeBots.find((b) => b.botId === botId);
    if (!bot || !bot.MESSAGE_ADDRESS) {
      console.warn(`Bot with ID ${botId} has no MESSAGE_ADDRESS`);
      return () => {};
    }

    const handler = (data: any) => {
      for (const el in data) {
        callback(data[el]);
      }
    };

    const unsubscribe = window.messenger.sub(
      eventType,
      bot.MESSAGE_ADDRESS,
      handler,
      options
        ? {
            throttle: options.throttle || 0,
            ignorePrevious: options.ignorePrevious || false,
          }
        : undefined,
    );

    return unsubscribe;
  }

  action<T extends BotAction>(botId: number, action: T, ...data: BotActionArgs[T]) {
    window.ipcRenderer.action('BOT_ACTION', { botId, action, data });
  }

  actionAsync<T extends BotAction>(
    botId: number,
    action: T,
    ...data: BotActionArgs[T]
  ): Promise<BotActionReturns[T]> {
    const bot = useSettingsStore
      .getState()
      .activeBots.find((activeBot) => activeBot.botId === botId);
    if (!bot?.MESSAGE_ADDRESS)
      return Promise.reject(new Error(`Bot with ID ${botId} has no MESSAGE_ADDRESS`));

    return window.messenger.request(
      'BOT_ACTION',
      bot.MESSAGE_ADDRESS as any,
      { action, data },
    ) as Promise<BotActionReturns[T]>;
  }
}

export const botEvents = new BotEventsClient();
export default botEvents;
