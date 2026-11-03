import snapshotLog, {
  logLine,
} from '../../src/main/src/workers/compiler/serializer';

describe('bounded worker log previews', () => {
  it('preserves sibling keys before expanding a large nested value', () => {
    const value = {
      first: Array.from({ length: 50 }, () =>
        Array.from({ length: 50 }, (_, id) => ({ id })),
      ),
      second: { status: 'ready' },
      third: { count: 2 },
    };

    expect(snapshotLog([value])).toMatchObject({
      second: { status: 'ready' },
      third: { count: 2 },
    });
  });

  it('keeps later keys visible when early strings exhaust the byte budget', () => {
    const value = Object.fromEntries(
      Array.from({ length: 20 }, (_, id) => [`key${id}`, 'x'.repeat(10_000)]),
    );
    const preview = snapshotLog([value]);

    expect(typeof preview).toBe('object');
    if (typeof preview !== 'object' || preview === null)
      throw new Error('Expected an expandable log preview');
    expect(Object.keys(preview)).toEqual(Object.keys(value));
    expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThanOrEqual(
      8 * 1024,
    );
  });

  it('preserves later arguments before expanding earlier ones', () => {
    const large = Array.from({ length: 50 }, () =>
      Array.from({ length: 50 }, (_, id) => ({ id })),
    );

    expect(snapshotLog([large, { status: 'ready' }])).toEqual([
      expect.any(Array),
      { status: 'ready' },
    ]);
  });

  it('keeps previews expandable with escaped values and oversized keys', () => {
    for (const value of [
      Object.fromEntries(
        Array.from({ length: 20 }, (_, id) => [
          `key${id}`,
          '\u0001'.repeat(10_000),
        ]),
      ),
      Object.fromEntries(
        Array.from({ length: 20 }, (_, id) => [
          `${id}${'\u0001'.repeat(10_000)}`,
          true,
        ]),
      ),
    ]) {
      const preview = snapshotLog([value]);
      expect(typeof preview).toBe('object');
      expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThanOrEqual(
        8 * 1024,
      );
    }
  });

  it('bounds a wide object before it can be transported', () => {
    const value = {
      items: Array.from({ length: 50_000 }, (_, id) => ({ id })),
    };
    const preview = snapshotLog([value]) as { items: unknown[] };

    expect(preview.items.length).toBeLessThan(100);
    expect(JSON.stringify(preview)).toContain('truncated');
    expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThanOrEqual(
      8 * 1024,
    );
  });

  it('keeps small objects expandable and handles cycles and getters', () => {
    const value: Record<string, unknown> = { child: { count: 2 } };
    value.self = value;
    Object.defineProperty(value, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error('read');
      },
    });

    expect(snapshotLog([value])).toMatchObject({
      child: { count: 2 },
      self: '[Circular]',
      secret: '[Getter]',
    });
  });

  it('does not throw on inaccessible proxies', () => {
    const proxy = Proxy.revocable({}, {});
    proxy.revoke();
    expect(() => snapshotLog([proxy.proxy])).not.toThrow();
    expect(logLine(snapshotLog([proxy.proxy]))).toContain('Uninspectable');
  });

  it('bounds deep values, long strings, and argument lists', () => {
    const preview = snapshotLog([
      {
        text: 'x'.repeat(100_000),
        nested: { a: { b: { c: { d: 1 } } } },
      },
    ]);
    expect(Buffer.byteLength(logLine(preview))).toBeLessThanOrEqual(8 * 1024);
    expect(logLine(preview)).toContain('truncated');

    const line = logLine(
      snapshotLog(Array.from({ length: 100 }, (_, id) => id)),
    );
    expect(line).toContain('omitted');
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(8 * 1024);
  });

  it('keeps a multi-argument call in one expandable snapshot', () => {
    expect(snapshotLog(['ready', { health: 20 }])).toEqual([
      'ready',
      { health: 20 },
    ]);
  });

  it('stays within the transport limit after JSON escapes control characters', () => {
    const preview = snapshotLog([{ text: '\u0001'.repeat(10_000) }]);
    expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThanOrEqual(
      8 * 1024,
    );
    expect(logLine(preview)).toContain('truncated');
  });
});
