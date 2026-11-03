/* eslint jest/no-standalone-expect: ["error", {"additionalTestBlockFunctions": ["nativeTest"]}] */
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { z } from 'zod';
import InferenceRuntime, {
  nativeBinding,
  NativeBinding,
} from '../../src/main/src/ai/runtime/engine';
import { loadModel } from '../../src/main/src/ai/runtime/model';
import Tokenizer from '../../src/main/src/ai/runtime/tokenizer';
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
function runtime(variant: 'main' | 'flash', cache = true): InferenceRuntime {
  if (!model)
    throw new Error('Set JNBOT_TEST_MODEL to a representation bundle.');
  return new InferenceRuntime(binding(cache), model, variant);
}
for (const variant of ['flash', 'main'] as const) {
  nativeTest(
    `${variant}: prefix reuse matches fresh requests across different inputs and long tool prefixes`,
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
      const cached = runtime(variant);
      cached.init(long);
      const results = queries.map((query) => cached.complete(query, 192));
      expect(cached.stats()).toEqual(
        expect.objectContaining({
          encoderLoaded: variant === 'main' ? 1 : 0,
          prefixReusedLayers: variant === 'main' ? 5 : 20,
          prefixReusedTokens: expect.any(Number),
        }),
      );
      expect(
        z.object({ prefixReusedTokens: z.number() }).parse(cached.stats())
          .prefixReusedTokens,
      ).toBeGreaterThan(256);
      cached.init(long);
      cached.complete(queries[0], 192);
      expect(
        z.object({ prefixReusedTokens: z.number() }).parse(cached.stats())
          .prefixReusedTokens,
      ).toBeGreaterThan(0);
      cached.init(tools);
      cached.complete(queries[0], 192);
      expect(
        z.object({ prefixReusedTokens: z.number() }).parse(cached.stats())
          .prefixReusedTokens,
      ).toBe(0);
      cached.close();
      const fresh = runtime(variant, false);
      fresh.init(long);
      expect(queries.map((query) => fresh.complete(query, 192))).toEqual(
        results,
      );
      fresh.close();
    },
    120000,
  );
}
nativeTest(
  'switching main to flash releases the encoder and maps only deployed decoder bytes',
  () => {
    if (!model) return;
    const main = runtime('main');
    expect(main.stats()).toEqual(expect.objectContaining({ encoderLoaded: 1 }));
    main.close();
    const flash = runtime('flash');
    expect(flash.stats()).toEqual(
      expect.objectContaining({
        encoderLoaded: 0,
        mappedWeightsBytes: loadModel(model, 'flash').decoder.length,
      }),
    );
    expect(() => flash.embed('text')).toThrow(/does not support embeddings/);
    flash.close();
  },
);
nativeTest(
  'tokenization, predictions and embeddings agree with the Python reference',
  () => {
    const referencePath = process.env.JNBOT_TEST_REFERENCE;
    if (!referencePath || !model)
      throw new Error(
        'Set JNBOT_TEST_REFERENCE to the independently generated reference JSON.',
      );
    const prediction = z.object({
      function_calls: z.array(
        z.object({
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()),
        }),
      ),
      reasoning: z.string().nullable(),
    });
    const reference = z
      .record(
        z.string(),
        z.object({
          tokens: z.array(z.number()),
          predictions: z.array(prediction),
          embedding: z.array(z.number()).nullable(),
        }),
      )
      .parse(JSON.parse(fs.readFileSync(referencePath, 'utf8')));
    const tokenizer = new Tokenizer(loadModel(model, 'flash').tokenizer);
    for (const variant of ['flash', 'main'] as const) {
      const actual = runtime(variant);
      actual.init(tools);
      expect(tokenizer.encode('héllo 😀 <tools>weather</tools>')).toEqual(
        reference[variant].tokens,
      );
      for (const [i, city] of ['Brussels', 'Paris'].entries()) {
        const result = actual.complete(
          `Get the weather for ${city}.`,
          192,
          true,
        );
        expect(result.calls).toEqual(
          reference[variant].predictions[i].function_calls,
        );
        expect(result.reasoning).toBe(
          reference[variant].predictions[i].reasoning,
        );
      }
      if (variant === 'main') {
        const values = actual.embed('diamond sword');
        const expected = reference.main.embedding;
        if (!expected) throw new Error('Missing reference embeddings.');
        const error = values.reduce(
          (sum, value, i) => sum + (value - expected[i]) ** 2,
          0,
        );
        const norm = expected.reduce((sum, value) => sum + value ** 2, 0);
        expect(Math.sqrt(error / norm)).toBeLessThan(0.005);
        expect(
          Math.abs(values.reduce((sum, value) => sum + value ** 2, 0) - 1),
        ).toBeLessThan(0.00005);
      }
      actual.close();
    }
  },
  120000,
);

nativeTest(
  'the packaged worker loads cached main and flash files through the real engine adapter',
  async () => {
    if (!model) return;
    const os = await import('os');
    const { loadNeedle } = await import('../../src/main/src/ai/NeedleEngine');
    const { defaultModel, resolveModel } = await import(
      '../../src/main/src/ai/model'
    );
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
      engine = await loadNeedle(directory, false);
      await engine.loadModel(defaultModel);
      await engine.init(tools);
      expect(
        (await engine.complete('Get the weather for Brussels.', 192)).calls,
      ).toEqual([{ name: 'weather', arguments: { city: 'Brussels' } }]);
      expect(
        (await engine.complete('Good morning everyone!', 192, false, 1)).calls,
      ).toEqual([]);
      expect(
        (await engine.complete('Get the weather for Brussels.', 192, false, -1))
          .calls,
      ).toEqual([{ name: 'weather', arguments: { city: 'Brussels' } }]);
      expect((await engine.embed('diamond sword')).length).toBe(768);
      await engine.loadModel(resolveModel(undefined, 'flash'));
      await engine.init(tools);
      expect(
        (await engine.complete('Get the weather for Paris.', 192)).calls,
      ).toEqual([{ name: 'weather', arguments: { city: 'Paris' } }]);
      await expect(engine.embed('text')).rejects.toMatchObject({
        code: 'AI_UNSUPPORTED_FEATURE',
      });
      expect(fs.readdirSync(directory)).toEqual([defaultModel.cacheId]);
    } finally {
      await engine?.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);

nativeTest(
  'main: deferred query encoding matches immediate memory and filtering skips decoding',
  () => {
    const instance = runtime('main');
    try {
      instance.init(tools);
      const baseline = instance.complete('Get the weather for Brussels.', 192);
      expect(
        instance.complete('Get the weather for Brussels.', 192, false, -1),
      ).toEqual(baseline);
      expect(
        instance.complete('Good morning everyone!', 192, false, 1),
      ).toEqual({
        calls: [],
        suppressedCalls: [],
        confidence: null,
        reasoning: null,
      });
      expect(instance.complete('Get the weather for Brussels.', 192)).toEqual(
        baseline,
      );
    } finally {
      instance.close();
    }
  },
);

nativeTest(
  'native tool similarities use reusable buffers and validate dimensions',
  () => {
    if (!model) return;
    const native = binding();
    const instance = new InferenceRuntime(native, model, 'flash');
    try {
      const matrix = new Float32Array(3 * 768);
      matrix[0] = 1;
      matrix[768 + 1] = 1;
      matrix[1536] = -1;
      const query = new Float32Array(768);
      query[0] = 1;
      const scores = new Float32Array(3);
      native.invoke('similarity', matrix, query, scores);
      expect(Array.from(scores)).toEqual([1, 0, -1]);
      query[0] = 0;
      query[1] = 1;
      native.invoke('similarity', matrix, query, scores);
      expect(Array.from(scores)).toEqual([0, 1, 0]);
      expect(() =>
        native.invoke('similarity', matrix, new Float32Array(2), scores),
      ).toThrow(/dimensions/);
    } finally {
      instance.close();
    }
  },
);
