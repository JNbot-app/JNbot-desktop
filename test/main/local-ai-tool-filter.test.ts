import { loadModel } from '../../src/main/src/ai/runtime/model';
import InferenceRuntime from '../../src/main/src/ai/runtime/engine';
import Tokenizer from '../../src/main/src/ai/runtime/tokenizer';
import ToolFilter from '../../src/main/src/ai/runtime/toolFilter';
import provenance from '../../native/needle/vendor/provenance.json';

function similarity(args: unknown[]): void {
  const [matrix, query, output] = args;
  if (
    !(matrix instanceof Float32Array) ||
    !(query instanceof Float32Array) ||
    !(output instanceof Float32Array)
  )
    throw new Error('Invalid similarity buffers');
  for (let i = 0; i < output.length; i += 1) {
    let score = 0;
    for (let j = 0; j < 768; j += 1) score += matrix[i * 768 + j] * query[j];
    output[i] = Math.max(-1, Math.min(1, score));
  }
}

jest.mock('../../src/main/src/ai/runtime/model', () => ({
  loadModel: jest.fn(),
}));

const tools = [
  {
    name: 'PlaceBlock',
    description: 'Place a block.',
    parameters: { type: 'object' as const },
  },
  {
    name: 'SellItem',
    description: 'Record an item sale.',
    parameters: { type: 'object' as const },
  },
];
const pieces = [
  '<|im_end|>',
  '<tool_call>',
  '</tool_call>',
  '<|im_start|>',
  '<think>',
  '</think>',
  '[{"name":"sell_item","arguments":{}}]',
  '[{"name":"place_block","arguments":{}}]',
  '[]',
];
function tokenizer(): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(pieces.length);
  return Buffer.concat([
    header,
    ...pieces.map((piece, index) => {
      const bytes = Buffer.from(piece);
      const record = Buffer.alloc(7);
      record[4] = index < 6 ? 3 : 0;
      record.writeUInt16LE(bytes.length, 5);
      return Buffer.concat([record, bytes]);
    }),
  ]);
}
function vector(x: number, y: number): Float32Array {
  const value = new Float32Array(768);
  value.set([x, y]);
  return value;
}
function fixture(variant: 'main' | 'flash' = 'main') {
  const base = {
    context: 4096,
    vocab: pieces.length,
    tokenizer: tokenizer(),
    decoder: { offset: 0, length: 1, format: 'cact' as const, sha256: '' },
    variant: 'flash' as const,
  };
  jest.mocked(loadModel).mockReturnValue(
    variant === 'flash'
      ? base
      : {
          ...base,
          variant: 'main',
          weights: new Float32Array(0),
          encoderContext: 2048,
          encoder: { offset: 0, length: 1, format: 'gguf', sha256: '' },
        },
  );
  let pending = false;
  const invoke = jest.fn((op: string, ...args: unknown[]): unknown => {
    if (op === 'identity') return provenance.encoderSourceSha256;
    if (op === 'similarity') similarity(args);
    if (op === 'reset') pending = false;
    if (op === 'encode') {
      pending = args[2] === true;
      const text = String(args[0]);
      if (text.startsWith('title:'))
        return text.includes('place block') ? vector(1, 0) : vector(0, 1);
      if (text.includes('unrelated')) return vector(-1, 0);
      return text.endsWith('sell') ? vector(0, 1) : vector(1, 0);
    }
    if (op === 'prepare') {
      if (!pending) throw new Error('Missing query encoding');
      pending = false;
    }
    if (op === 'eval') {
      const logits = args[1];
      if (!(logits instanceof Float32Array)) throw new Error('Missing logits');
      logits.fill(-100);
      logits[6] = 10;
      logits[7] = 9.9;
      logits[2] = 9.8;
      logits[8] = 5; // No call is a clear second choice, so the call passes the confidence floor.
      logits[0] = 9.6;
    }
    return undefined;
  });
  const runtime = new InferenceRuntime({ invoke }, 'fixture', variant);
  runtime.init(tools);
  invoke.mockClear();
  return { runtime, invoke };
}

test('filter shares one query encoding, blocks excluded tools and reuses selected prefixes', () => {
  const spy = jest.spyOn(Tokenizer.prototype, 'preparePrefix');
  const { runtime, invoke } = fixture();
  expect(runtime.complete('place', 16, false, 0.5).calls).toEqual([
    { name: 'PlaceBlock', arguments: {} },
  ]);
  expect(spy.mock.calls.at(-1)?.[0]).not.toContain('sell_item');
  expect(
    invoke.mock.calls.filter(
      ([op, text]) => op === 'encode' && String(text).startsWith('task:'),
    ),
  ).toHaveLength(1);
  expect(invoke).toHaveBeenCalledWith(
    'encode',
    'task: search result | query: place',
    false,
    true,
  );
  expect(invoke).toHaveBeenCalledWith('prepare');
  const builds = spy.mock.calls.length;
  runtime.complete('place', 16, false, 0.5);
  expect(spy).toHaveBeenCalledTimes(builds);
  expect(
    invoke.mock.calls.filter(
      ([op, text]) => op === 'encode' && String(text).startsWith('title:'),
    ),
  ).toHaveLength(2);
  invoke.mockClear();
  expect(runtime.complete('sell', 16, false, 0.5).calls[0].name).toBe(
    'SellItem',
  );
  expect(invoke).toHaveBeenCalledWith('prefix', 0);
  invoke.mockClear();
  runtime.complete('place', 16);
  expect(invoke).toHaveBeenCalledWith('prefix', 0);
  expect(spy.mock.calls.at(-1)?.[0]).toContain('sell_item');
  spy.mockRestore();
  runtime.close();
});

test('empty selection skips memory preparation and decoder work, then recovers', () => {
  const { runtime, invoke } = fixture();
  expect(runtime.complete('unrelated', 16, false, 0.5).calls).toEqual([]);
  expect(
    invoke.mock.calls.some(([op]) => op === 'prepare' || op === 'eval'),
  ).toBe(false);
  expect(invoke.mock.calls.at(-1)).toEqual(['reset']);
  expect(runtime.complete('place', 16, false, 0.5).calls[0].name).toBe(
    'PlaceBlock',
  );
  runtime.close();
});

test('disabled and flash paths never index tools or defer memory', () => {
  for (const variant of ['main', 'flash'] as const) {
    const { runtime, invoke } = fixture(variant);
    const baseline = runtime.complete('place', 16);
    expect(runtime.complete('place', 16, false, null)).toEqual(baseline);
    expect(
      runtime.complete('place', 16, false, variant === 'flash' ? 0.5 : null),
    ).toEqual(baseline);
    expect(
      invoke.mock.calls.some(
        ([op, text]) => op === 'encode' && String(text).startsWith('title:'),
      ),
    ).toBe(false);
    expect(invoke.mock.calls.some(([op]) => op === 'prepare')).toBe(false);
    expect(invoke.mock.calls.filter(([op]) => op === 'encode')).toHaveLength(
      variant === 'flash' ? 0 : 3,
    );
    runtime.close();
  }
});

test('encoder failures clear pending state and preserve the registered catalogue', () => {
  const { runtime, invoke } = fixture();
  runtime.complete('place', 16, false, 0.5);
  invoke
    .mockImplementationOnce(() => undefined)
    .mockImplementationOnce(() => {
      throw new Error('encoding failed');
    });
  expect(() => runtime.complete('place', 16, false, 0.5)).toThrow(
    'encoding failed',
  );
  expect(invoke.mock.calls.at(-1)).toEqual(['reset']);
  expect(runtime.complete('place', 16, false, 0.5).calls[0].name).toBe(
    'PlaceBlock',
  );
  runtime.close();
});

test('document index invalidates changed text, keeps order and includes threshold equality', () => {
  const index = new ToolFilter();
  const normalized = tools.map((tool, i) => ({
    ...tool,
    name: i ? 'sell_item' : 'place_block',
  }));
  const invoke = jest.fn((op: string, ...args: unknown[]) => {
    if (op === 'similarity') {
      similarity(args);
      return undefined;
    }
    return String(args[0]).includes('place block')
      ? vector(1, 0)
      : vector(0, 1);
  });
  index.setTools(normalized);
  index.prepare({ invoke });
  expect(index.select(vector(1, 0), 0, { invoke })).toEqual(normalized);
  index.setTools([...normalized].reverse());
  index.prepare({ invoke });
  expect(invoke.mock.calls.filter(([op]) => op === 'encode')).toHaveLength(2);
  expect(index.select(vector(1, 0), 0, { invoke })).toEqual(
    [...normalized].reverse(),
  );
  index.setTools([{ ...normalized[0], description: 'Place stone.' }]);
  index.prepare({ invoke });
  expect(invoke.mock.calls.filter(([op]) => op === 'encode')).toHaveLength(3);
  expect(index.select(vector(1, 0), 1, { invoke })).toHaveLength(1);
});
