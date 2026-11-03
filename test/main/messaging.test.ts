import {
  Address,
  BACKEND,
  FIELD_BASE,
  KIND_FACTOR,
  MAX_FIELD_ID,
  MessageRouter,
  Messenger,
  RegisteredRoute,
  RunIdAllocator,
  TransportFrame,
  clientAddress,
  decodeAddress,
  formatAddress,
  workerBotAddress,
  workerProfileAddress,
  workerScriptAddress,
  decodeNetworkFrame,
  encodeNetworkFrame,
  materializeFrame,
} from '../../src/common/messaging';
import type { EndpointTransport } from '../../src/common/messaging';
import { BotMessenger } from '../../src/main/src/workers/lib/BotMessenger';
import type { Bot } from '../../src/main/src/workers/workerTypes';

class TestTransport implements EndpointTransport {
  receiver?: (frame: TransportFrame) => void;
  sent: TransportFrame[] = [];
  received: TransportFrame[] = [];

  send(frame: TransportFrame): void {
    this.sent.push(frame);
  }

  async sendAsync(frame: TransportFrame): Promise<void> {
    this.send(frame);
  }

  subscribe(receiver: (frame: TransportFrame) => void): () => void {
    this.receiver = receiver;
    return () => {
      this.receiver = undefined;
    };
  }

  receive(frame: TransportFrame): void {
    this.received.push(frame);
    this.receiver?.(frame);
  }
}

function route(
  address: Address,
  transport: TestTransport,
  profileId?: number,
): RegisteredRoute {
  return {
    route: { id: String(address), address, profileId },
    address,
    profileId,
    send: (frame) => transport.receive(frame),
    sendAsync: async (frame) => transport.receive(frame),
  };
}

describe('messaging addresses', () => {
  test.each([1, 5000, MAX_FIELD_ID])('round-trips field boundary %s', (id) => {
    expect(decodeAddress(clientAddress(id))).toMatchObject({
      kind: 'client',
      leafId: id,
    });
    expect(decodeAddress(workerProfileAddress(id))).toMatchObject({
      kind: 'worker',
      profileId: id,
      scriptId: 0,
      leafId: 0,
    });
    expect(decodeAddress(workerScriptAddress(id, id))).toMatchObject({
      profileId: id,
      scriptId: id,
      leafId: 0,
    });
    expect(decodeAddress(workerBotAddress(id, id, id))).toMatchObject({
      profileId: id,
      scriptId: id,
      leafId: id,
    });
  });

  test('uses arithmetic fields without signed 32-bit truncation', () => {
    const address = workerBotAddress(5000, 5000, 5000);
    expect(address).toBeGreaterThan(2 ** 32);
    expect(address).toBeLessThan(2 ** 48);
    expect(formatAddress(address)).toBe('worker:5000/5000/5000');
  });

  test('rejects reserved, malformed, and overflowing values', () => {
    expect(() => clientAddress(0)).toThrow();
    expect(() => workerBotAddress(1, 0, 1)).toThrow();
    expect(() => workerScriptAddress(1, FIELD_BASE)).toThrow();
    expect(() => decodeAddress(1 as Address)).toThrow();
    expect(() => decodeAddress((8 * KIND_FACTOR) as Address)).toThrow();
  });

  test('allocator never wraps', () => {
    const allocator = new RunIdAllocator('test');
    for (let i = 1; i <= MAX_FIELD_ID; i += 1)
      expect(allocator.allocate()).toBe(i);
    expect(() => allocator.allocate()).toThrow('ID space exhausted');
  });
});

describe('messenger request routing', () => {
  test('shared worker delivery ignores responses addressed to another messenger', async () => {
    const scriptTransport = new TestTransport();
    const botTransport = new TestTransport();
    const script = new Messenger(workerScriptAddress(1, 1), scriptTransport);
    const bot = new Messenger(workerBotAddress(1, 1, 4), botTransport);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const pending = script.request('worker:action', BACKEND);
      const request = scriptTransport.sent[0].envelope;
      const response: TransportFrame = {
        envelope: {
          ...request,
          type: 'response',
          from: BACKEND,
          to: script.address,
          data: 'done',
        },
      };
      botTransport.receive(response);
      scriptTransport.receive(response);
      await expect(pending).resolves.toBe('done');
      expect(warn).not.toHaveBeenCalled();
      // Duplicates addressed to this messenger still warrant a diagnostic.
      scriptTransport.receive(response);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      await script.close();
      await bot.close();
    }
  });

  test('routes concurrent request responses only to their requesters', async () => {
    const backendTransport = new TestTransport();
    const backend = new Messenger(BACKEND, backendTransport, 1000);
    const router = new MessageRouter((frame) =>
      backendTransport.receive(frame),
    );
    backendTransport.send = (frame) => router.receive(null, frame);

    const firstAddress = clientAddress(1);
    const secondAddress = clientAddress(2);
    const firstTransport = new TestTransport();
    const secondTransport = new TestTransport();
    const firstRoute = route(firstAddress, firstTransport);
    const secondRoute = route(secondAddress, secondTransport);
    router.register(firstRoute);
    router.register(secondRoute);
    firstTransport.send = (frame) => router.receive(firstRoute, frame);
    secondTransport.send = (frame) => router.receive(secondRoute, frame);
    const first = new Messenger(firstAddress, firstTransport, 1000);
    const second = new Messenger(secondAddress, secondTransport, 1000);

    backend.sub('lookup', BACKEND, async (data) => {
      const value = data as number;
      await new Promise((resolve) => setTimeout(resolve, value === 1 ? 10 : 1));
      return `result-${value}`;
    });

    await expect(
      Promise.all([
        first.request('lookup', BACKEND, 1),
        second.request('lookup', BACKEND, 2),
      ]),
    ).resolves.toEqual(['result-1', 'result-2']);
  });

  test('allows an explicitly unbounded request even when router default TTL is exceeded', async () => {
    const senderAddress = clientAddress(1);
    const receiverAddress = workerScriptAddress(1, 1);
    const senderTransport = new TestTransport();
    const receiverTransport = new TestTransport();
    const senderRoute = route(senderAddress, senderTransport);
    const receiverRoute = route(receiverAddress, receiverTransport, 1);
    // Router default TTL is 5ms, shorter than the 20ms work
    const router = new MessageRouter(() => undefined, 5);
    router.register(senderRoute);
    router.register(receiverRoute);
    senderTransport.send = (frame) => router.receive(senderRoute, frame);
    receiverTransport.send = (frame) => router.receive(receiverRoute, frame);

    const sender = new Messenger(senderAddress, senderTransport, 1);
    const receiver = new Messenger(receiverAddress, receiverTransport, 1);
    receiver.sub('queued-work', receiverAddress, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'done';
    });

    await expect(
      sender.request('queued-work', receiverAddress, undefined, {
        timeoutMs: 0,
      }),
    ).resolves.toBe('done');
  });

  test('preserves reverse route for custom timeout exceeding router TTL', async () => {
    const senderAddress = clientAddress(2);
    const receiverAddress = workerScriptAddress(1, 2);
    const senderTransport = new TestTransport();
    const receiverTransport = new TestTransport();
    const senderRoute = route(senderAddress, senderTransport);
    const receiverRoute = route(receiverAddress, receiverTransport, 1);
    // Router default TTL is 5ms, but request timeoutMs is 50ms
    const router = new MessageRouter(() => undefined, 5);
    router.register(senderRoute);
    router.register(receiverRoute);
    senderTransport.send = (frame) => router.receive(senderRoute, frame);
    receiverTransport.send = (frame) => router.receive(receiverRoute, frame);

    const sender = new Messenger(senderAddress, senderTransport, 100);
    const receiver = new Messenger(receiverAddress, receiverTransport, 100);
    receiver.sub('delayed-work', receiverAddress, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'done-custom';
    });

    await expect(
      sender.request('delayed-work', receiverAddress, undefined, {
        timeoutMs: 50,
      }),
    ).resolves.toBe('done-custom');
  });

  test('rejects forged origins', () => {
    const transport = new TestTransport();
    const address = clientAddress(1);
    const registered = route(address, transport);
    const router = new MessageRouter(() => undefined);
    router.register(registered);
    expect(() =>
      router.receive(registered, {
        envelope: {
          version: 1,
          type: 'send',
          event: 'forged',
          to: BACKEND,
          from: clientAddress(2),
          data: null,
        },
      }),
    ).toThrow('Forged message origin');
  });

  test('broadcasts only to subscribed matching routes', () => {
    const firstTransport = new TestTransport();
    const workerTransport = new TestTransport();
    const firstAddress = clientAddress(1);
    const workerAddress = workerScriptAddress(1, 1);
    const firstRoute = route(firstAddress, firstTransport, 1);
    const workerRoute = route(workerAddress, workerTransport, 1);
    const router = new MessageRouter(() => undefined);
    router.register(firstRoute);
    router.register(workerRoute);

    for (const registered of [firstRoute, workerRoute]) {
      router.receive(registered, {
        envelope: {
          version: 1,
          type: 'subscribe',
          event: 'settings',
          to: registered.address,
          from: registered.address,
          data: undefined,
        },
      });
    }
    router.receive(null, {
      envelope: {
        version: 1,
        type: 'publish',
        event: 'settings',
        to: { broadcast: 'clients' },
        from: BACKEND,
        data: { enabled: true },
      },
    });
    expect(firstTransport.received).toHaveLength(1);
    expect(firstTransport.received[0].envelope.data).toEqual({ enabled: true });
    expect(workerTransport.received).toHaveLength(0);
  });

  test('keeps same-named bot subscriptions isolated by bot address', () => {
    const clientAddress_ = clientAddress(1);
    const firstScript = workerScriptAddress(1, 1);
    const secondScript = workerScriptAddress(1, 2);
    const firstBot = workerBotAddress(1, 1, 1);
    const secondBot = workerBotAddress(1, 2, 1);
    const clientTransport = new TestTransport();
    const firstWorkerTransport = new TestTransport();
    const secondWorkerTransport = new TestTransport();
    const clientRoute = route(clientAddress_, clientTransport);
    const firstWorkerRoute = route(firstScript, firstWorkerTransport, 1);
    const secondWorkerRoute = route(secondScript, secondWorkerTransport, 1);
    const router = new MessageRouter(() => undefined);
    router.register(clientRoute);
    router.register(firstWorkerRoute);
    router.register(secondWorkerRoute);
    clientTransport.send = (frame) => router.receive(clientRoute, frame);
    firstWorkerTransport.send = (frame) =>
      router.receive(firstWorkerRoute, frame);
    secondWorkerTransport.send = (frame) =>
      router.receive(secondWorkerRoute, frame);

    const client = new Messenger(clientAddress_, clientTransport, 1000);
    const first = new Messenger(firstBot, firstWorkerTransport, 1000);
    const second = new Messenger(secondBot, secondWorkerTransport, 1000);
    const firstValues: unknown[] = [];
    const secondValues: unknown[] = [];
    const unsubscribeFirst = client.sub('inventory', firstBot, (data) => {
      firstValues.push(data);
    });
    client.sub('inventory', secondBot, (data) => {
      secondValues.push(data);
    });

    first.send('inventory', clientAddress_, ['first']);
    second.send('inventory', clientAddress_, ['second']);
    expect(firstValues).toEqual([['first']]);
    expect(secondValues).toEqual([['second']]);

    unsubscribeFirst();
    first.send('inventory', clientAddress_, ['ignored']);
    expect(firstValues).toEqual([['first']]);
    expect(secondValues).toEqual([['second']]);
  });

  test('manual reply sends exactly one response', async () => {
    const firstAddress = clientAddress(1);
    const firstTransport = new TestTransport();
    const backendTransport = new TestTransport();
    const backend = new Messenger(BACKEND, backendTransport, 1000);
    const first = new Messenger(firstAddress, firstTransport, 1000);
    const router = new MessageRouter((frame) =>
      backendTransport.receive(frame),
    );
    const firstRoute = route(firstAddress, firstTransport);
    router.register(firstRoute);
    backendTransport.send = (frame) => router.receive(null, frame);
    firstTransport.send = (frame) => router.receive(firstRoute, frame);
    backend.sub('manual', BACKEND, (_data, context) => context.reply('only'));
    await expect(first.request('manual', BACKEND)).resolves.toBe('only');
    expect(
      firstTransport.received.filter(
        (frame) => frame.envelope.type === 'response',
      ),
    ).toHaveLength(1);
  });

  test('network forwarding preserves the encoded payload bytes', () => {
    const payload = { nested: ['unchanged', 42] };
    const encoded = encodeNetworkFrame({
      envelope: {
        version: 1,
        type: 'send',
        event: 'opaque',
        to: BACKEND,
        from: clientAddress(1),
        data: payload,
      },
    });
    const decoded = decodeNetworkFrame(encoded);
    expect(decoded.envelope.data).toBeUndefined();
    expect(decoded.encodedPayload).toBe(JSON.stringify(payload));
    expect(encodeNetworkFrame(decoded)).toBe(encoded);
  });

  test('network frames encode void responses as valid JSON', () => {
    const encoded = encodeNetworkFrame({
      envelope: {
        version: 1,
        type: 'response',
        event: 'delete',
        to: clientAddress(1),
        from: BACKEND,
        correlationId: 1,
        data: undefined,
      },
    });

    expect(materializeFrame(decodeNetworkFrame(encoded)).envelope.data).toBeNull();
  });

  test('routes backend requests to a bot through its script endpoint', async () => {
    const backendTransport = new TestTransport();
    const backend = new Messenger(BACKEND, backendTransport, 1000);
    const router = new MessageRouter((frame) =>
      backendTransport.receive(frame),
    );
    backendTransport.send = (frame) => router.receive(null, frame);

    const scriptAddress = workerScriptAddress(1, 1);
    const botAddress = workerBotAddress(1, 1, 7);
    const workerTransport = new TestTransport();
    const workerRoute = route(scriptAddress, workerTransport, 1);
    router.register(workerRoute);
    workerTransport.send = (frame) => router.receive(workerRoute, frame);
    const worker = new Messenger(scriptAddress, workerTransport, 1000);
    worker.sub('bot:get', scriptAddress, (_data, context) => {
      expect(context.destination).toBe(botAddress);
      return 'bot-result';
    });

    await expect(backend.request('bot:get', botAddress)).resolves.toBe(
      'bot-result',
    );
  });
});

describe('bot messenger publications', () => {
  test('batches a subscriber payload and keeps array payloads intact', async () => {
    jest.useFakeTimers();
    try {
      const bot = { botId: 7 } as Bot;
      const messenger = new BotMessenger(1, 1, bot);
      const client = clientAddress(1);
      const send = jest.spyOn(messenger, 'send');
      (
        messenger as unknown as {
          onSubscribe: (message: unknown) => void;
        }
      ).onSubscribe({
        event: 'movement',
        from: client,
        data: { throttle: 20 },
      });

      messenger.publish('movement', [1, 2, 3]);
      messenger.publish('movement', [4, 5, 6]);
      expect(send).not.toHaveBeenCalled();

      jest.advanceTimersByTime(20);
      expect(send).toHaveBeenCalledWith('movement', client, [
        [1, 2, 3],
        [4, 5, 6],
      ]);
      await messenger.close();
    } finally {
      jest.useRealTimers();
    }
  });

  test('drops buffered bot payloads when ignorePrevious is enabled', async () => {
    jest.useFakeTimers();
    try {
      const bot = { botId: 8 } as Bot;
      const messenger = new BotMessenger(1, 1, bot);
      const client = clientAddress(1);
      const send = jest.spyOn(messenger, 'send');
      (
        messenger as unknown as {
          onSubscribe: (message: unknown) => void;
        }
      ).onSubscribe({
        event: 'movement',
        from: client,
        data: { throttle: 20, ignorePrevious: true },
      });

      messenger.publish('movement', 'old');
      messenger.publish('movement', 'latest');
      jest.advanceTimersByTime(20);
      expect(send).toHaveBeenCalledWith('movement', client, ['latest']);
      await messenger.close();
    } finally {
      jest.useRealTimers();
    }
  });
});
