import { buildScriptRuntime } from '../../src/main/src/workers/compiler/scriptRuntime';
import workerScript from '../../src/main/src/workers/lib/workerScript';

jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: {
    workerData: {},
    send: jest.fn(),
    sendAsync: jest.fn(),
    sendToClients: jest.fn(),
  },
}));
jest.mock('../../src/main/src/workers/bot/statemachines/BotMachine', () => ({
  __esModule: true,
  default: jest.fn(),
  patchedBotMachine: jest.fn(),
}));
jest.mock('../../src/main/src/workers/bot/Bot', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../src/main/src/workers/lib/WorkerAutomationApi', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../src/main/src/workers/bot/proxyV3', () => ({}));
jest.mock('../../src/main/src/workers/compiler/scriptApi', () => ({}));

test('the real script factory exposes local AI and forwards serialized definitions', async () => {
  const runtime = buildScriptRuntime({
    name: 'local-ai',
    language: 'js',
    type: 'script',
  } as Parameters<typeof buildScriptRuntime>[0]);
  const { script } = runtime;
  expect(script.ai).toBeDefined();
  expect((await script.ai.createAgent().predict('anything')).status).toBe(
    'no_match',
  );
  expect(workerScript.sendAsync).not.toHaveBeenCalled();
  const handler = jest.fn();
  jest.mocked(workerScript.sendAsync).mockResolvedValue({
    kind: 'prediction',
    prediction: {
      status: 'calls',
      calls: [{ name: 'act', arguments: {} }],
      suppressedCalls: [],
      confidence: null,
      reasoning: null,
      toolsetRevision: 0,
      modelId: 'fixture',
    },
    terminal: false,
  });
  const agent = script.ai.createAgent({
    modelUrl: 'https://example.com/tuned.cact?v=1',
    tools: [
      {
        name: 'act',
        description: 'Act',
        parameters: { type: 'object' },
        handler,
      },
    ],
  });
  expect((await agent.predict('act')).calls[0].name).toBe('act');
  expect(handler).not.toHaveBeenCalled();
  await agent.predict('act', { timeoutMs: 3_000_000_000 });
  expect(workerScript.sendAsync).toHaveBeenLastCalledWith(
    'AI_REQUEST',
    expect.anything(),
    { timeoutMs: 0 },
  );
  expect(workerScript.sendAsync).toHaveBeenCalledWith(
    'AI_REQUEST',
    expect.objectContaining({
      kind: 'predict',
      modelUrl: 'https://example.com/tuned.cact?v=1',
      tools: [
        { name: 'act', description: 'Act', parameters: { type: 'object' } },
      ],
    }),
    expect.objectContaining({ timeoutMs: expect.any(Number) }),
  );
});

test('script network restrictions also apply to custom model selection', async () => {
  const { script } = buildScriptRuntime({
    name: 'restricted',
    language: 'js',
    type: 'script',
    security: { ai: { networkAllowed: false } },
  } as Parameters<typeof buildScriptRuntime>[0]);
  expect(() =>
    script.ai.createAgent({ modelUrl: 'https://example.com/tuned.cact' }),
  ).toThrow(/network/);
  expect((await script.ai.createAgent().predict('empty')).status).toBe(
    'no_match',
  );
});
