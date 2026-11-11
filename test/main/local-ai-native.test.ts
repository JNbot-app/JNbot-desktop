/* eslint jest/no-standalone-expect: ["error", {"additionalTestBlockFunctions": ["nativeTest"]}] */
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { z } from 'zod';
import InferenceRuntime, {
  nativeBinding,
  NativeBinding,
} from '../../src/main/src/ai/runtime/engine';
import type { ToolDefinition } from '../../src/main/src/ai/protocol';

// Real-model checks are opt-in: production weights are not committed or downloaded by tests.
const model = process.env.JNBOT_TEST_MODEL;
const nativeTest = model ? test : test.skip;
const tools: ToolDefinition[] = [
  {
    name: 'weather',
    description: 'Get weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
      additionalProperties: false,
    },
  },
];
function binding(cache = true): NativeBinding {
  const requireNative = createRequire(path.resolve('package.json'));
  const native = nativeBinding(
    requireNative(
      path.resolve(
        'assets/needle',
        `${process.platform}-${process.arch}`,
        'needle.node',
      ),
    ),
  );
  return cache
    ? native
    : {
        invoke: (operation, ...args) =>
          native.invoke(operation, ...(operation === 'prefix' ? [0] : args)),
      };
}
function runtime(cache = true): InferenceRuntime {
  if (!model) throw new Error('Set JNBOT_TEST_MODEL to a model file.');
  return new InferenceRuntime(binding(cache), model);
}
function reused(instance: InferenceRuntime): number {
  return z.object({ prefixReusedTokens: z.number() }).parse(instance.stats())
    .prefixReusedTokens;
}
for (const windowSize of [512, 1024]) {
  nativeTest(
    `window ${windowSize}: prefix reuse matches fresh requests across inputs and long tool prefixes`,
    () => {
      const long = structuredClone(tools);
      long[0].description +=
        ' Returns weather without changing anything.'.repeat(38);
      const queries = [
        'Get the weather for Brussels.',
        'Get the weather for Paris.',
        'Get the weather for Zürich.',
        'Get the weather for Brussels.',
      ];
      const cached = runtime();
      cached.init(long);
      const results = queries.map((query) =>
        cached.complete(query, 192, false, windowSize),
      );
      expect(reused(cached)).toBeGreaterThan(256);
      cached.init(long);
      cached.complete(queries[0], 192, false, windowSize);
      expect(reused(cached)).toBeGreaterThan(256);
      cached.init(tools);
      cached.complete(queries[0], 192, false, windowSize);
      expect(reused(cached)).toBe(0);
      cached.close();
      const fresh = runtime(false);
      fresh.init(long);
      expect(
        queries.map((query) => fresh.complete(query, 192, false, windowSize)),
      ).toEqual(results);
      expect(results[0].calls).toEqual([
        { name: 'weather', arguments: { city: 'Brussels' } },
      ]);
      fresh.close();
    },
    120000,
  );
}
nativeTest('maps the decoder and rejects windows beyond the model context', () => {
  if (!model) return;
  const instance = runtime();
  try {
    expect(instance.stats()).toEqual(
      expect.objectContaining({ mappedWeightsBytes: fs.statSync(model).size }),
    );
    instance.init(tools);
    expect(() =>
      instance.complete('Get the weather for Paris.', 192, false, 8193),
    ).toThrow(expect.objectContaining({ code: 'AI_INVALID_INPUT' }));
    expect(
      instance.complete('Get the weather for Paris.', 192, false, 512).calls,
    ).toEqual([{ name: 'weather', arguments: { city: 'Paris' } }]);
  } finally {
    instance.close();
  }
});

nativeTest(
  'the packaged worker loads a cached model through the real engine adapter',
  async () => {
    if (!model) return;
    const os = await import('os');
    const { loadNeedle } = await import('../../src/main/src/ai/NeedleEngine');
    const { defaultModel } = await import('../../src/main/src/ai/model');
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'jnbot-ai-worker-'),
    );
    let engine: Awaited<ReturnType<typeof loadNeedle>> | undefined;
    try {
      const installed = path.join(
        directory,
        defaultModel.cacheId,
        'model.cact',
      );
      fs.mkdirSync(path.dirname(installed));
      fs.copyFileSync(model, installed, fs.constants.COPYFILE_FICLONE);
      fs.writeFileSync(`${installed}.sha256`, defaultModel.sha256 ?? '');
      engine = await loadNeedle(directory, false);
      await engine.loadModel(defaultModel);
      await engine.init(tools);
      expect(
        (await engine.complete('Get the weather for Brussels.', 192, false, 512))
          .calls,
      ).toEqual([{ name: 'weather', arguments: { city: 'Brussels' } }]);
      expect(
        (await engine.complete('Good morning everyone!', 192, false, 512)).calls,
      ).toEqual([]);
      expect(
        (await engine.complete('Get the weather for Paris.', 192, false, 1024))
          .calls,
      ).toEqual([{ name: 'weather', arguments: { city: 'Paris' } }]);
      expect(fs.readdirSync(directory)).toEqual([defaultModel.cacheId]);
    } finally {
      await engine?.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);
