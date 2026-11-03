import {
  canonicalJson,
  hashToolArguments,
  redactMcpValue,
  safeHashEquals,
  sha256,
  consumeRateLimit,
} from '../../src/main/src/functions/mcp/security';

describe('MCP security helpers', () => {
  test('canonical hashes do not depend on object key order', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(hashToolArguments('move', { b: 2, a: 1 })).toBe(
      hashToolArguments('move', { a: 1, b: 2 }),
    );
  });

  test('exact hashes reject changed source and parameters', () => {
    const first = sha256('const value = 1');
    expect(safeHashEquals(first, sha256('const value = 1'))).toBe(true);
    expect(safeHashEquals(first, sha256('const value = 2'))).toBe(false);
  });

  test('redaction strips nested credentials and bearer tokens', () => {
    expect(
      redactMcpValue({
        username: 'Bot',
        password: 'secret',
        nested: { authToken: 'abc', header: 'Bearer opaque.value' },
      }),
    ).toEqual({
      username: 'Bot',
      password: '[REDACTED]',
      nested: { authToken: '[REDACTED]', header: '[REDACTED]' },
    });
  });

  test('rate limits are isolated and expire by window', () => {
    const windows = new Map<string, number[]>();
    expect(consumeRateLimit(windows, 'a', 2, 1_000, 1_000)).toBe(true);
    expect(consumeRateLimit(windows, 'a', 2, 1_000, 1_001)).toBe(true);
    expect(consumeRateLimit(windows, 'a', 2, 1_000, 1_002)).toBe(false);
    expect(consumeRateLimit(windows, 'b', 2, 1_000, 1_002)).toBe(true);
    expect(consumeRateLimit(windows, 'a', 2, 1_000, 2_002)).toBe(true);
  });

});
