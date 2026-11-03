import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import Ajv from 'ajv';
import { loadModel } from '../../src/main/src/ai/runtime/model';
import Tokenizer from '../../src/main/src/ai/runtime/tokenizer';
import PreparedGrammar from '../../src/main/src/ai/runtime/grammar';
import prepareTools from '../../src/main/src/ai/runtime/tools';
import InferenceRuntime from '../../src/main/src/ai/runtime/engine';
import JsonState from '../../src/main/src/ai/runtime/jsonState';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-ai-format-'));
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});
function tokenizerBlob(pieces: [string, number, number][]): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(pieces.length);
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(0, 16);
  return Buffer.concat([
    header,
    ...pieces.map(([piece, type, score]) => {
      const bytes = Buffer.from(piece);
      const record = Buffer.alloc(7);
      record.writeFloatLE(score);
      record[4] = type;
      record.writeUInt16LE(bytes.length, 5);
      return Buffer.concat([record, bytes]);
    }),
  ]);
}
function archive(pieces: [string, number, number][] = [['a', 0, 0]]): Buffer {
  const tokenizer = tokenizerBlob(pieces);
  const header = Buffer.alloc(384);
  header.writeUInt32LE(0x05e12a84);
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(28, 8);
  header.writeUInt32LE(pieces.length, 20);
  header.writeUInt32LE(1024, 52);
  header[308] = 4;
  header.writeBigUInt64LE(384n, 328);
  header.writeBigUInt64LE(BigInt(tokenizer.length), 336);
  return Buffer.concat([header, tokenizer]);
}

describe('without ICU, as in the iOS Node runtime', () => {
  beforeEach(() => {
    const Decoder = global.TextDecoder;
    jest
      .spyOn(global, 'TextDecoder')
      .mockImplementation((encoding, options) => {
        if (options?.fatal)
          throw Object.assign(
            new TypeError(
              '"fatal" option is not supported on Node.js compiled without ICU',
            ),
            { code: 'ERR_NO_ICU' },
          );
        return new Decoder(encoding, options);
      });
  });
  afterEach(() => jest.restoreAllMocks());

  test('a valid model loads and preserves Unicode tokenizer pieces', () => {
    const file = path.join(directory, 'mobile.cact');
    fs.writeFileSync(file, archive([['é😀', 0, 0]]));
    const invoke = jest.fn();
    const runtime = new InferenceRuntime({ invoke }, file, 'flash');
    expect(invoke).toHaveBeenCalledWith('load', file, 0, expect.any(Number));
    runtime.close();
    const tokenizer = new Tokenizer(tokenizerBlob([['é😀', 0, 0]]));
    expect(tokenizer.decode(tokenizer.encode('é😀'))).toBe('é😀');
    const malformed = tokenizerBlob([['a', 0, 0]]);
    malformed[malformed.length - 1] = 0xc2;
    expect(() => new Tokenizer(malformed)).toThrow(/Invalid model tokenizer/);
  });

  test('JSON strings accept Unicode split across tokens and reject malformed UTF-8', () => {
    const state = () => new JsonState({ type: 'string' }, new Map(), new Ajv());
    const valid = state();
    for (const byte of Buffer.from('"é😀�\\u00e9"'))
      valid.feed(Buffer.from([byte]));
    expect(valid.done).toBe(true);
    expect(valid.value).toBe('é😀�é');
    for (const bytes of [
      [0x80],
      [0xc0],
      [0xc2, 0x22],
      [0xe0, 0x80],
      [0xed, 0xa0],
      [0xf0, 0x80],
      [0xf4, 0x90],
      [0xf5],
      [0xe2, 0x5c, 0x6e],
    ]) {
      const invalid = state();
      invalid.feed(Buffer.from('"'));
      expect(() => invalid.feed(Buffer.from(bytes))).toThrow();
    }
    const prefix = state();
    prefix.feed(Buffer.from([0x22, 0xe0]));
    const branch = prefix.clone();
    prefix.feed(Buffer.from([0xa0, 0x80, 0x22]));
    expect(prefix.value).toBe('\u0800');
    expect(() => branch.feed(Buffer.from([0x80]))).toThrow();
  });
});

test.each([null, 0.8, 0.01])(
  'inference handles reasoning and confidence %p',
  (headConfidence) => {
    const pieces: [string, number, number][] = [
      ['<|im_end|>', 3, 0],
      ['<think>', 3, 0],
      ['analysis', 0, 0],
      ['</think>', 3, 0],
      ['<tool_call>', 3, 0],
      ['[{"name":"act","arguments":{}}]', 0, 0],
      ['</tool_call>', 3, 0],
      ['<|im_start|>', 3, 0],
    ];
    const file = path.join(directory, 'reasoning.cact');
    fs.writeFileSync(file, archive(pieces));
    const evaluated: number[] = [];
    const runtime = new InferenceRuntime(
      {
        invoke(operation, ...args) {
          if (operation === 'confidence') return headConfidence;
          if (operation === 'eval') {
            const [ids, logits] = args;
            if (
              !(ids instanceof Int32Array) ||
              !(logits instanceof Float32Array)
            )
              throw new Error('Expected inference buffers.');
            if (ids.length === 1) evaluated.push(ids[0]);
            logits.fill(-100);
            logits[ids.length === 1 ? ids[0] + 1 : 1] = 100;
          }
          return undefined;
        },
      },
      file,
      'flash',
    );
    try {
      runtime.init([
        { name: 'act', description: 'Act', parameters: { type: 'object' } },
      ]);
      for (const reasoning of [undefined, true, false]) {
        evaluated.length = 0;
        const calls = [{ name: 'act', arguments: {} }];
        const withheld = headConfidence !== null && headConfidence < 0.1;
        expect(runtime.complete('act', 16, reasoning)).toEqual({
          calls: withheld ? [] : calls,
          suppressedCalls: withheld
            ? calls.map((c) => ({ ...c, reason: 'low_confidence' }))
            : [],
          confidence: headConfidence,
          reasoning: reasoning ? 'analysis' : null,
        });
        expect(evaluated).toEqual(reasoning ? [1, 2, 3, 4, 5, 6] : [4, 5, 6]);
      }
    } finally {
      runtime.close();
    }
  },
);
function bundled(
  change?: (index: {
    format: string;
    version: number;
    manifest: object;
    sections: Record<
      string,
      { offset: number; length: number; format: string; sha256: string }
    >;
  }) => void,
): string {
  const bytes = archive();
  const index = {
    format: 'needle-model-bundle',
    version: 1,
    manifest: {},
    sections: {
      needle: {
        offset: 0,
        length: bytes.length,
        format: 'cact',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    },
  };
  change?.(index);
  const json = Buffer.from(JSON.stringify(index));
  const footer = Buffer.alloc(64);
  footer.write('NDLBNDL1');
  footer.writeUInt32LE(1, 8);
  footer.writeBigUInt64LE(BigInt(bytes.length), 16);
  footer.writeBigUInt64LE(BigInt(json.length), 24);
  createHash('sha256').update(json).digest().copy(footer, 32);
  const file = path.join(directory, 'bundle.cact');
  fs.writeFileSync(file, Buffer.concat([bytes, json, footer]));
  return file;
}

test('flash reads bare and stripped bundles; main capability failures preserve the file', () => {
  const bare = path.join(directory, 'bare.cact');
  fs.writeFileSync(bare, archive());
  expect(loadModel(bare, 'flash').decoder.length).toBe(archive().length);
  const file = bundled();
  expect(loadModel(file, 'flash').vocab).toBe(1);
  expect(() => loadModel(file, 'main')).toThrow(/main variant/);
  expect(fs.existsSync(file)).toBe(true);
});
test.each(['bounds', 'alignment', 'version', 'hash'])(
  'bundle reader rejects invalid %s',
  (fault) => {
    const file = bundled((index) => {
      if (fault === 'bounds') index.sections.needle.length += 9999;
      if (fault === 'alignment') index.sections.needle.offset = 64;
      if (fault === 'version') index.version = 2;
      if (fault === 'hash') index.sections.needle.sha256 = '0'.repeat(64);
    });
    expect(() => loadModel(file, 'flash')).toThrow();
  },
);
test('tokenizer preserves deterministic BPE merges, Unicode and special markers', () => {
  const tokenizer = new Tokenizer(
    tokenizerBlob([
      ['<|im_end|>', 3, 0],
      ['a', 0, 0],
      ['b', 0, 0],
      ['ab', 0, 1],
      ['😀', 0, 0],
    ]),
  );
  expect(tokenizer.encode('ab😀<|im_end|>')).toEqual([3, 4, 0]);
  expect(tokenizer.decode([3, 4, 0])).toBe('ab😀<|im_end|>');
});
test('schema decoder accepts escaped Unicode and nested values and restores colliding public names', () => {
  const pieces: [string, number, number][] = [
    ['<|im_end|>', 3, 0],
    ['<tool_call>', 3, 0],
    ['</tool_call>', 3, 0],
    ...Array.from(
      new Set(Array.from('[]{}":,abcdefghijklmnopqrstuvwxyz_0123456789\\ u-')),
    ).map((s): [string, number, number] => [s, 0, 0]),
  ];
  const tokenizer = new Tokenizer(tokenizerBlob(pieces));
  const prepared = prepareTools([
    {
      name: 'SetValue',
      description: 'set',
      parameters: {
        type: 'object',
        properties: {
          myField: { type: 'string', enum: ['é'] },
          my_field: { type: 'array', items: { type: 'integer', minimum: 1 } },
        },
        required: ['myField', 'my_field'],
        additionalProperties: false,
      },
    },
  ]);
  const sampler = new PreparedGrammar(prepared.tools, tokenizer).sampler();
  const call =
    '[{"name":"set_value","arguments":{"my_field":"\\u00e9","my_field_":[2]}}]';
  for (const token of [
    tokenizer.id('<tool_call>'),
    ...tokenizer.encode(call),
    tokenizer.id('</tool_call>'),
  ])
    sampler.advance(token);
  expect(sampler.mode).toBe('closed');
  expect(
    prepared.restore({
      name: 'set_value',
      arguments: { my_field: 'é', my_field_: [2] },
    }),
  ).toEqual({ name: 'SetValue', arguments: { myField: 'é', my_field: [2] } });
});

test('prepared prefix tokenization matches full tokenization across the query boundary', () => {
  const tokenizer = new Tokenizer(
    tokenizerBlob([
      ['</tools>', 3, 0],
      ['a', 0, 0],
      ['b', 0, 0],
      ['ab', 0, 1],
      ['\n', 0, 0],
      ['▁', 0, 0],
      ['😀', 0, 0],
    ]),
  );
  const prefix = 'aab</tools>\n';
  const prepared = tokenizer.preparePrefix(prefix);
  expect(prepared.tokens.length).toBeGreaterThan(0);
  for (const query of ['ab', 'b', '😀', ' ab'])
    expect([...prepared.tokens, ...prepared.append(query)]).toEqual(
      tokenizer.encode(prefix + query),
    );
});
