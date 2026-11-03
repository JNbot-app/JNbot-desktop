import { clientAddress, workerBotAddress, type MessageEnvelope } from '../../src/common/messaging';
import { BotMessenger } from '../../src/main/src/workers/lib/BotMessenger';
import type { Bot } from '../../src/main/src/workers/workerTypes';

class TestBotMessenger extends BotMessenger {
  add(from: number) {
    this.onSubscribe(this.message('subscribe', from));
  }

  remove(from: number) {
    this.onUnsubscribe(this.message('unsubscribe', from));
  }

  private message(type: 'subscribe' | 'unsubscribe', from: number): MessageEnvelope {
    return { version: 1, type, event: 'map-entities', from: clientAddress(from), to: workerBotAddress(1, 1, 1), data: null };
  }
}

test('entity stream starts on first subscriber and stops on last', async () => {
  const messenger = new TestBotMessenger(1, 1, { botId: 1 } as Bot);
  const start = jest.fn();
  const additional = jest.fn();
  const stop = jest.fn();
  const disposeStart = messenger.onSubscription('map-entities', start);
  const disposeAdditional = messenger.onAdditionalSubscription('map-entities', additional);
  const disposeStop = messenger.onUnsubscription('map-entities', stop);
  const send = jest.spyOn(messenger, 'send').mockImplementation(() => undefined);

  messenger.add(1);
  messenger.add(2);
  expect(start).toHaveBeenCalledTimes(1);
  expect(additional).toHaveBeenCalledWith(clientAddress(2));
  expect(messenger.hasSubscribers('map-entities')).toBe(true);
  messenger.publishTo('map-entities', clientAddress(2), [{ id: 3 }]);
  expect(send).toHaveBeenCalledWith('map-entities', clientAddress(2), [[{ id: 3 }]]);
  expect(send).toHaveBeenCalledTimes(1);

  messenger.remove(1);
  expect(stop).not.toHaveBeenCalled();
  messenger.remove(2);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(messenger.hasSubscribers('map-entities')).toBe(false);

  disposeStart();
  disposeAdditional();
  disposeStop();
  await messenger.close();
});
