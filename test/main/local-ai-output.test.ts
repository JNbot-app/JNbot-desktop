import {
  CALL_PROBABILITY_FLOOR,
  CallTracker,
  constrainedLogProbability,
  gateCalls,
} from '../../src/main/src/ai/runtime/output';
import type { ToolDefinition } from '../../src/main/src/ai/protocol';

const TOOLS: ToolDefinition[] = [
  {
    name: 'sell_item',
    description: 'Sell an item.',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string' },
        price: { type: 'integer' },
        note: { type: 'string' },
        mode: { type: 'string', enum: ['on', 'off'] },
      },
      required: ['item'],
      additionalProperties: false,
    },
  },
];
const call = (args: Record<string, unknown>) => ({
  name: 'sell_item',
  arguments: args as never,
});

test('call tracker assigns JSON bytes to the call they belong to', () => {
  const tracker = new CallTracker();
  const pieces = [
    '[{"',
    'name":"a',
    '","x":"}{"',
    '}',
    ',{"',
    'name":"b"}',
    ']',
  ];
  expect(pieces.map((piece) => [...tracker.feed(Buffer.from(piece))])).toEqual([
    [0],
    [0],
    [0],
    [0],
    [1],
    [1],
    [],
  ]);
});

test('constrained log-probability renormalises over grammar-valid tokens', () => {
  const logits = Float32Array.from([2, 1, 1]);
  const full = 2 - Math.log(Math.exp(2) + 2 * Math.exp(1));
  const onlyFirst = { allows: (token: number) => token === 0 };
  expect(constrainedLogProbability(logits, 0, full, onlyFirst)).toBeCloseTo(0);
  const all = { allows: () => true };
  expect(constrainedLogProbability(logits, 0, full, all)).toBeCloseTo(full);
  // A near-certain token skips the grammar checks.
  const never = {
    allows: () => {
      throw new Error('checked');
    },
  };
  expect(constrainedLogProbability(logits, 0, -1e-5, never)).toBe(-1e-5);
});

test('low-probability calls are withheld and stay reviewable', () => {
  const sale = call({ item: 'sword' });
  const low = gateCalls([sale], TOOLS, 'sell my sword', {
    callProbabilities: [CALL_PROBABILITY_FLOOR - 0.01],
  });
  expect(low).toEqual({
    calls: [],
    suppressedCalls: [{ ...sale, reason: 'low_confidence' }],
  });
  expect(
    gateCalls([sale], TOOLS, 'sell my sword', {
      callProbabilities: [CALL_PROBABILITY_FLOOR],
    }).calls,
  ).toEqual([sale]);
  expect(
    gateCalls([sale], TOOLS, 'sell my sword', { headConfidence: 0.05 }).calls,
  ).toEqual([]);
});

test('values must come from the request', () => {
  // A required value absent from the request withholds the call.
  expect(
    gateCalls([call({ item: 'shield' })], TOOLS, 'sell my sword')
      .suppressedCalls[0].reason,
  ).toBe('ungrounded');
  // Optional values absent from the request are dropped; numbers need a quantity.
  expect(
    gateCalls(
      [call({ item: 'sword', note: '$150', price: 3, mode: 'constructor' })],
      TOOLS,
      'sell my sword',
    ).calls,
  ).toEqual([call({ item: 'sword' })]);
  expect(
    gateCalls(
      [call({ item: 'sword', price: 3, mode: 'on' })],
      TOOLS,
      'sell my sword for three gold, turn it on',
    ).calls,
  ).toEqual([call({ item: 'sword', price: 3, mode: 'on' })]);
});

test('negated requests are withheld and duplicates removed', () => {
  expect(
    gateCalls([call({ item: 'sword' })], TOOLS, "don't sell my sword")
      .suppressedCalls[0].reason,
  ).toBe('negated');
  const sale = call({ item: 'sword' });
  expect(gateCalls([sale, sale], TOOLS, 'sell my sword').calls).toEqual([sale]);
});
