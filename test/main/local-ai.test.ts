import AiClient from '../../src/main/src/ai/AiClient';
import { AiService } from '../../src/main/src/ai/AiService';
import type { AiEngine } from '../../src/main/src/ai/NeedleEngine';
import { RequestScope } from '../../src/main/src/ai/request';
import { defaultModel, resolveModel } from '../../src/main/src/ai/model';
import type { AiTool } from '../../src/common/types/pluginApi';

function fixture() {
  const complete = jest.fn();
  const engine: AiEngine = {
    loadModel: jest.fn(async () => undefined),
    init: jest.fn(async () => undefined),
    complete,
    embed: jest.fn(async () => [1, 0, 0]),
    reset: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  const load = jest.fn(async () => engine);
  const service = new AiService(load);
  const client = new AiClient((request) =>
    service.request('plugin-a', request),
  );
  return { complete, engine, load, service, client };
}

function output(name?: string, quantity = 1) {
  return {
    calls: name ? [{ name, arguments: { quantity } }] : [],
    suppressedCalls: [],
    confidence: null,
    reasoning: null,
    terminal: !name,
  };
}

function tool(handler?: AiTool['handler']): AiTool {
  return {
    name: 'give',
    description: 'Give items',
    parameters: {
      type: 'object',
      properties: { quantity: { type: 'integer', minimum: 1 } },
      required: ['quantity'],
    },
    handler,
  };
}

test('agent embeddings use the selected model without tools and reject flash', async () => {
  const { client, engine, load, service } = fixture();
  try {
    const flash = client.createAgent({ model: 'flash' });
    await expect(flash.embed('hello')).rejects.toMatchObject({
      code: 'AI_UNSUPPORTED_FEATURE',
    });
    expect(load).not.toHaveBeenCalled();
    const modelUrl = 'https://example.com/agent.cact';
    const agent = client.createAgent({ modelUrl });
    await expect(agent.embed('hello')).resolves.toEqual({
      modelId: resolveModel(modelUrl).id,
      values: [1, 0, 0],
    });
    expect(engine.embed).toHaveBeenCalledWith('hello');
    agent.dispose();
    await expect(agent.embed('hello')).rejects.toMatchObject({
      code: 'AI_DISPOSED',
    });
  } finally {
    await service.close();
  }
});

test.each(['dispose', 'abort', 'timeout'] as const)(
  'agent embeddings stop on %s',
  async (cancel) => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const cancelled: string[] = [];
    const client = new AiClient(async (request) => {
      if (request.kind === 'cancel') {
        cancelled.push(request.requestId);
        return { kind: 'ended' };
      }
      started();
      return new Promise<never>(() => {
        // Keep backend work pending until the caller cancels.
      });
    });
    const agent = client.createAgent();
    const controller = new AbortController();
    const pending = agent.embed('hello', {
      signal: controller.signal,
      timeoutMs: cancel === 'timeout' ? 20 : 1000,
    });
    const settled = pending.catch((error: unknown) => error);
    await ready;
    if (cancel === 'dispose') agent.dispose();
    if (cancel === 'abort') controller.abort();
    await expect(settled).resolves.toMatchObject({
      code: cancel === 'timeout' ? 'AI_TIMEOUT' : 'AI_CANCELLED',
    });
    expect(cancelled).toHaveLength(1);
  },
);

test('reasoning defaults off and can be enabled or disabled for each request', async () => {
  const { client, complete, service } = fixture();
  const agent = client.createAgent({ tools: [tool(() => 1)] });
  complete.mockResolvedValue(output('give'));
  for (const reasoning of [undefined, true, false]) {
    const options = reasoning === undefined ? {} : { reasoning };
    await agent.predict('give', options);
    expect(complete).toHaveBeenLastCalledWith('give', 512, reasoning ?? false);
    expect((await agent.run('give', options)).status).toBe('completed');
    expect(complete).toHaveBeenLastCalledWith('give', 512, reasoning ?? false);
    complete.mockResolvedValueOnce(output('extract'));
    await client.extract('one', tool().parameters, options);
    expect(complete).toHaveBeenLastCalledWith(
      expect.any(String),
      512,
      reasoning ?? false,
    );
  }
  await expect(
    service.request('plugin', {
      kind: 'predict',
      requestId: 'invalid-reasoning',
      deadline: Date.now() + 10_000,
      text: 'give',
      tools: [tool()],
      revision: 0,
      maxNewTokens: 512,
      reasoning: 'true',
    }),
  ).rejects.toMatchObject({ code: 'AI_INVALID_INPUT' });
  await service.close();
});

test('creation, edits and empty requests do not load a model; prediction does not execute', async () => {
  const { client, load, complete, service } = fixture();
  const agent = client.createAgent();
  expect((await agent.predict('hello')).status).toBe('no_match');
  expect((await agent.run('hello')).status).toBe('no_match');
  const handler = jest.fn();
  agent.addTool(tool(handler));
  expect(load).not.toHaveBeenCalled();
  complete.mockResolvedValue(output('give', 3));
  expect((await agent.predict('give 3')).calls[0].arguments.quantity).toBe(3);
  expect(handler).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
  await service.close();
});

test('model choices stay lazy and report the selected ID for empty requests', async () => {
  const { client, engine, load, service } = fixture();
  const options = { modelUrl: 'https://example.com/custom.cact' };
  const model = resolveModel(options.modelUrl);
  const agent = client.createAgent(options);
  options.modelUrl = 'https://example.com/other.cact';
  expect((await agent.predict('empty')).modelId).toBe(model.id);
  const result = await agent.run('empty');
  expect(result.modelId).toBe(model.id);
  expect(result.prediction?.modelId).toBe(model.id);
  expect(load).not.toHaveBeenCalled();
  expect(engine.loadModel).not.toHaveBeenCalled();
  await service.close();
});

test('custom models apply to prediction, runs, extraction and embeddings', async () => {
  const { client, engine, complete, service } = fixture();
  const modelUrl = 'https://example.com/custom.cact?v=1';
  const model = resolveModel(modelUrl);
  complete.mockResolvedValue(output('give'));
  const agent = client.createAgent({ tools: [tool(() => 1)], modelUrl });
  expect((await agent.predict('give')).modelId).toBe(model.id);
  complete.mockResolvedValue(output());
  expect((await agent.run('give')).modelId).toBe(model.id);
  complete.mockResolvedValue(output('extract', 2));
  expect(await client.extract('two', tool().parameters, { modelUrl })).toEqual({
    quantity: 2,
  });
  expect((await client.embed('hello', { modelUrl })).modelId).toBe(model.id);
  expect(engine.loadModel).toHaveBeenCalledTimes(1);
  expect(engine.loadModel).toHaveBeenCalledWith(model, expect.any(AbortSignal));
  expect((await client.embed('default', { modelUrl: ' ' })).modelId).toBe(
    defaultModel.id,
  );
  expect(engine.loadModel).toHaveBeenCalledTimes(2);
  await service.close();
});

test('different models can load while an independent run awaits its handler', async () => {
  const { client, engine, complete, service } = fixture();
  const other = new AiClient((request) => service.request('plugin-b', request));
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const modelUrl = 'https://example.com/custom.cact';
  complete
    .mockResolvedValueOnce(output('give'))
    .mockResolvedValueOnce(output());
  const running = client
    .createAgent({
      modelUrl,
      tools: [
        tool(async () => {
          entered();
          await waiting;
          return 1;
        }),
      ],
    })
    .run('give');
  await started;
  const embedding = other.embed('default');
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  expect(engine.loadModel).toHaveBeenCalledTimes(2);
  release();
  const result = await running;
  expect(result.modelId).toBe(resolveModel(modelUrl).id);
  expect(result.prediction?.modelId).toBe(result.modelId);
  expect((await embedding).modelId).toBe(defaultModel.id);
  expect(engine.loadModel).toHaveBeenCalledTimes(2);
  await client.embed('custom again', { modelUrl });
  expect(engine.loadModel).toHaveBeenCalledTimes(3);
  await service.close();
});

test('failed model switches do not fall back and leave the queue usable', async () => {
  const { client, engine, complete, service } = fixture();
  complete.mockResolvedValue(output());
  await client.embed('default');
  jest
    .mocked(engine.loadModel)
    .mockRejectedValueOnce(
      Object.assign(new Error('bad model'), { code: 'AI_MODEL' }),
    );
  const agent = client.createAgent({
    tools: [tool()],
    modelUrl: 'https://example.com/bad.cact',
  });
  const failed = await agent.run('give');
  expect(failed.error?.code).toBe('AI_MODEL');
  expect(failed.modelId).toBe(resolveModel('https://example.com/bad.cact').id);
  expect(engine.embed).toHaveBeenCalledTimes(1);
  await client.embed('default again');
  expect(engine.loadModel).toHaveBeenCalledTimes(3);
  await agent.predict('retry');
  expect(engine.loadModel).toHaveBeenCalledTimes(4);
  await service.close();
});

test('model loading receives cancellation and releases queued requests', async () => {
  const { client, engine, service } = fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  jest
    .mocked(engine.loadModel)
    .mockImplementationOnce(async (_model, signal) => {
      entered();
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    });
  const controller = new AbortController();
  const pending = client.embed('cancel', {
    modelUrl: 'https://example.com/custom.cact',
    signal: controller.signal,
  });
  const rejection = pending.catch((error: unknown) => error);
  await started;
  controller.abort();
  expect(await rejection).toMatchObject({ code: 'AI_CANCELLED' });
  expect((await client.embed('next')).modelId).toBe(defaultModel.id);
  await service.close();
});

test('invalid URLs and denied custom selections never reach inference', async () => {
  const { client, load, service } = fixture();
  expect(() =>
    client.createAgent({ modelUrl: 'http://example.com/model' }),
  ).toThrow(/HTTPS/);
  await expect(
    client.embed('bad', { modelUrl: 'bad URL' }),
  ).rejects.toMatchObject({ code: 'AI_INVALID_INPUT' });
  await expect(
    service.request('plugin', {
      kind: 'embed',
      requestId: 'bad',
      deadline: Date.now() + 10_000,
      text: 'bad',
      modelUrl: 42,
    }),
  ).rejects.toMatchObject({ code: 'AI_INVALID_INPUT' });
  const restricted = new AiClient(
    (request) => service.request('restricted', request),
    false,
  );
  await expect(
    service.request(
      'restricted',
      {
        kind: 'embed',
        requestId: 'denied',
        deadline: Date.now() + 10_000,
        text: 'bad',
        modelUrl: 'https://example.com/custom.cact',
      },
      false,
    ),
  ).rejects.toMatchObject({ code: 'AI_INVALID_INPUT' });
  expect(() =>
    restricted.createAgent({ modelUrl: 'https://example.com/custom.cact' }),
  ).toThrow(/network/);
  await expect(
    restricted.embed('bad', { modelUrl: 'https://example.com/custom.cact' }),
  ).rejects.toMatchObject({ code: 'AI_INVALID_INPUT' });
  expect(
    (
      await restricted
        .createAgent({ modelUrl: defaultModel.url })
        .predict('empty')
    ).modelId,
  ).toBe(defaultModel.id);
  expect(load).not.toHaveBeenCalled();
  await service.close();
});

test('runs retain tool snapshots and execute one prediction without feeding results back', async () => {
  const { client, complete, service } = fixture();
  const agent = client.createAgent();
  const first = jest.fn(async () => {
    agent.addTool(tool(() => 99));
    return 4;
  });
  agent.setTools([tool(first)]);
  complete
    .mockResolvedValueOnce(output('give', 2))
    .mockResolvedValueOnce(output('give', 3))
    .mockResolvedValueOnce(output());
  const result = await agent.run('give twice');
  expect(result.status).toBe('completed');
  expect(result.toolsetRevision).toBe(1);
  expect(first).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(result.steps).toBe(1);
  complete.mockReset();
  agent.addTool(
    tool(() => {
      throw new Error('handler failed');
    }),
  );
  complete.mockResolvedValue(output('give'));
  const failed = await agent.run('give');
  expect(failed.status).toBe('failed');
  expect(failed.results[0].error?.message).toBe('handler failed');
  await service.close();
});

test('tool edits are atomic, schemas are cloned and there is no registration limit', async () => {
  const { client, complete, service } = fixture();
  const definition = tool();
  const agent = client.createAgent({ tools: [definition] });
  definition.parameters.required = ['missing'];
  expect(() => agent.setTools([tool(), tool()])).toThrow(/Duplicate/);
  agent.removeTool('absent');
  complete.mockResolvedValue(output('give'));
  expect((await agent.predict('give')).toolsetRevision).toBe(0);
  agent.setTools(
    Array.from({ length: 100 }, (_, i) => ({ ...tool(), name: `tool_${i}` })),
  );
  complete.mockResolvedValue(output('tool_99'));
  expect((await agent.predict('give')).calls[0].name).toBe('tool_99');
  expect(() =>
    agent.addTool({
      ...tool(),
      parameters: { type: 'object', format: 'secret' },
    } as AiTool),
  ).toThrow(/format/);
  await service.close();
});

test('concurrent clients share initialization while handlers do not hold inference', async () => {
  const { client, complete, load, service } = fixture();
  const other = new AiClient((request) => service.request('plugin-b', request));
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  complete
    .mockResolvedValueOnce(output('give'))
    .mockResolvedValueOnce(output('give'));
  const running = client
    .createAgent({
      tools: [
        tool(async () => {
          entered();
          await waiting;
          return 1;
        }),
      ],
    })
    .run('give');
  await started;
  const prediction = other.createAgent({ tools: [tool()] }).predict('give');
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  expect(complete).toHaveBeenCalledTimes(2);
  release();
  expect((await running).status).toBe('completed');
  expect((await prediction).status).toBe('calls');
  expect(load).toHaveBeenCalledTimes(1);
  await service.close();
});

test('one-shot runs preserve schema failures, missing handlers and recursion protection', async () => {
  const { client, complete, service } = fixture();
  complete.mockResolvedValue(output('give'));
  const handler = jest.fn(() => 1);
  expect(
    (await client.createAgent({ tools: [tool(handler)] }).run('give')).status,
  ).toBe('completed');
  expect(handler).toHaveBeenCalledTimes(1);
  expect(
    (await client.createAgent({ tools: [tool()] }).run('give')).error?.code,
  ).toBe('AI_MISSING_HANDLER');
  complete.mockResolvedValue(output('give', 0));
  expect(
    (await client.createAgent({ tools: [tool(handler)] }).run('give')).status,
  ).toBe('failed');
  expect(handler).toHaveBeenCalledTimes(1);
  complete.mockResolvedValue(output('give'));
  const recursive = client.createAgent({
    tools: [tool(() => client.embed('again'))],
  });
  expect((await recursive.run('give')).error?.code).toBe('AI_REENTRANT');
  await service.close();
});

test('extraction and embeddings use the shared service; dispose and cancellation settle work', async () => {
  const { client, complete, service, load } = fixture();
  complete.mockResolvedValue(output('extract', 2));
  expect(await client.extract('two', tool().parameters)).toEqual({
    quantity: 2,
  });
  expect((await client.embed('hello')).values).toEqual([1, 0, 0]);
  expect(load).toHaveBeenCalledTimes(1);
  const disposed = client.createAgent({ tools: [tool()] });
  disposed.dispose();
  await expect(disposed.predict('give')).rejects.toMatchObject({
    code: 'AI_DISPOSED',
  });
  const controller = new AbortController();
  controller.abort();
  expect(
    (
      await client
        .createAgent({ tools: [tool(() => 1)] })
        .run('give', { signal: controller.signal })
    ).status,
  ).toBe('cancelled');
  await service.close();
});

test('failed initialization and completion release the queue and later requests can retry', async () => {
  const { client, load, complete, service } = fixture();
  const initialLoad = load.getMockImplementation()!;
  load
    .mockRejectedValueOnce(
      Object.assign(new Error('offline'), { code: 'AI_DOWNLOAD' }),
    )
    .mockImplementation(initialLoad);
  const agent = client.createAgent({ tools: [tool(() => 1)] });
  expect((await agent.run('give')).error?.code).toBe('AI_DOWNLOAD');
  complete
    .mockRejectedValueOnce(new Error('engine failed'))
    .mockResolvedValue(output('give'));
  expect((await agent.run('give')).status).toBe('failed');
  expect((await agent.predict('give')).status).toBe('calls');
  expect(load).toHaveBeenCalledTimes(2);
  await service.close();
});

test('malformed requests and removed conversation operations reject before loading', async () => {
  const { service, load } = fixture();
  for (const kind of ['embed', 'begin', 'continue', 'end']) {
    await expect(
      service.request('a', { kind, requestId: 'bad' }),
    ).rejects.toBeDefined();
  }
  expect(load).not.toHaveBeenCalled();
  await service.close();
});

test('cancelling other inference leaves a running handler intact', async () => {
  const { client, complete, service } = fixture();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  complete
    .mockResolvedValueOnce(output('give'))
    .mockResolvedValueOnce(output());
  const running = client
    .createAgent({
      tools: [
        tool(async () => {
          entered();
          await wait;
          return 1;
        }),
      ],
    })
    .run('give');
  await started;
  const controller = new AbortController();
  const pending = client.embed('queued', { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
  release();
  expect((await running).status).toBe('completed');
  await service.close();
});

test('withheld output never executes and non-JSON results stop the batch', async () => {
  const { client, complete, service } = fixture();
  const handler = jest.fn(() => 1);
  complete.mockResolvedValue({
    ...output(),
    suppressedCalls: [{ name: 'give', arguments: { quantity: 1 } }],
  });
  expect(
    (await client.createAgent({ tools: [tool(handler)] }).run('give')).status,
  ).toBe('withheld');
  expect(handler).not.toHaveBeenCalled();
  complete.mockResolvedValue({
    ...output('give'),
    calls: [
      { name: 'give', arguments: { quantity: 1 } },
      { name: 'give', arguments: { quantity: 2 } },
    ],
  });
  const bad = jest.fn(() => Number.NaN);
  const result = await client
    .createAgent({ tools: [tool(bad)] })
    .run('give twice');
  expect(result.status).toBe('failed');
  expect(result.results).toHaveLength(1);
  expect(bad).toHaveBeenCalledTimes(1);
  await service.close();
});

test('cancelling inference returns before native work ends and releases the queue afterward', async () => {
  const { client, complete, service } = fixture();
  const controller = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<ReturnType<typeof output>>((resolve) => {
    release = () => resolve(output());
  });
  complete.mockImplementationOnce(() => {
    entered();
    return waiting;
  });
  const running = client
    .createAgent({ tools: [tool(() => 1)] })
    .run('give', { signal: controller.signal });
  await started;
  controller.abort();
  expect((await running).status).toBe('cancelled');
  release();
  complete.mockResolvedValue(output());
  await client.createAgent({ tools: [tool()] }).predict('another');
  await service.close();
});

test('timeouts longer than Node timer capacity do not expire immediately', () => {
  jest.useFakeTimers();
  const scope = new RequestScope({ timeoutMs: 2_147_483_648 });
  jest.advanceTimersByTime(2_147_483_647);
  expect(scope.controller.signal.aborted).toBe(false);
  jest.advanceTimersByTime(1);
  expect(scope.controller.signal.aborted).toBe(true);
  scope.close();
  jest.useRealTimers();
});

test('variants are lazy, default to main, and flash embeddings reject at both API boundaries', async () => {
  const { client, load, complete, engine, service } = fixture();
  const flash = client.createAgent({ model: 'flash' });
  expect((await flash.predict('empty')).modelId).toBe(
    resolveModel(undefined, 'flash').id,
  );
  await expect(client.embed('text', { model: 'flash' })).rejects.toMatchObject({
    code: 'AI_UNSUPPORTED_FEATURE',
  });
  await expect(
    service.request('raw', {
      kind: 'embed',
      requestId: 'flash',
      deadline: Date.now() + 10000,
      text: 'text',
      model: 'flash',
    }),
  ).rejects.toMatchObject({ code: 'AI_UNSUPPORTED_FEATURE' });
  const restricted = new AiClient(
    (request) => service.request('restricted', request, false),
    false,
  );
  await expect(
    restricted.embed('text', {
      model: 'flash',
      modelUrl: 'https://example.com/custom.cact',
    }),
  ).rejects.toMatchObject({ code: 'AI_UNSUPPORTED_FEATURE' });
  expect(load).not.toHaveBeenCalled();
  expect(() => resolveModel(undefined, 'unknown')).toThrow(/main or flash/);
  complete.mockResolvedValue(output('give'));
  flash.addTool(tool());
  await flash.predict('give');
  expect(engine.loadModel).toHaveBeenLastCalledWith(
    resolveModel(undefined, 'flash'),
    expect.any(AbortSignal),
  );
  await client.createAgent({ tools: [tool()] }).predict('give');
  expect(engine.loadModel).toHaveBeenLastCalledWith(
    defaultModel,
    expect.any(AbortSignal),
  );
  const url = 'https://example.com/custom.cact';
  expect(resolveModel(url, 'flash').cacheId).toBe(
    resolveModel(url, 'main').cacheId,
  );
  expect(resolveModel(url, 'flash').id).not.toBe(resolveModel(url, 'main').id);
  await service.close();
});

test('tool filtering defaults off and forwards a threshold for predict, run and extract', async () => {
  const { client, complete, service } = fixture();
  const agent = client.createAgent({ tools: [tool(() => 1)] });
  complete.mockResolvedValue(output('give'));
  for (const threshold of [undefined, null, 0, -1, 1, 0.75]) {
    const options = { toolFilterThreshold: threshold };
    await agent.predict('give', options);
    const args = threshold == null ? [] : [threshold];
    expect(complete).toHaveBeenLastCalledWith('give', 512, false, ...args);
    await agent.run('give', options);
    expect(complete).toHaveBeenLastCalledWith('give', 512, false, ...args);
    complete.mockResolvedValueOnce(output('extract'));
    await client.extract('one', tool().parameters, options);
    expect(complete).toHaveBeenLastCalledWith(
      expect.any(String),
      512,
      false,
      ...args,
    );
  }
  await service.close();
});

test.each([NaN, Infinity, -Infinity, -1.01, 1.01, '0.5', true])(
  'tool filtering rejects invalid thresholds before loading: %p',
  async (threshold) => {
    const { load, service } = fixture();
    // Exercise the untyped transport boundary too.
    await expect(
      service.request('plugin', {
        kind: 'predict',
        requestId: 'invalid-filter',
        deadline: Date.now() + 10000,
        text: 'give',
        tools: [tool()],
        revision: 0,
        maxNewTokens: 512,
        toolFilterThreshold: threshold,
      }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_INPUT' });
    expect(load).not.toHaveBeenCalled();
    await service.close();
  },
);

test.each([NaN, Infinity, -Infinity, -1.01, 1.01])(
  'client rejects invalid tool thresholds: %p',
  async (threshold) => {
    const { client, load, service } = fixture();
    const agent = client.createAgent({ tools: [tool()] });
    await expect(
      agent.predict('give', { toolFilterThreshold: threshold }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_INPUT' });
    expect(load).not.toHaveBeenCalled();
    await service.close();
  },
);
