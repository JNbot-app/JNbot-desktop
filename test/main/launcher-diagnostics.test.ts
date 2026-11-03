import {
  LauncherDiagnostics,
  appendTextTail,
} from '../../src/main/src/functions/minecraft/LauncherDiagnostics';

describe('LauncherDiagnostics', () => {
  test('keeps entries ordered while enforcing count and byte budgets', () => {
    const diagnostics = new LauncherDiagnostics({
      maxEntries: 3,
      maxBytes: 12,
      maxMessageBytes: 8,
    });

    diagnostics.begin('launch-a');
    diagnostics.append('launch-a', 'one', 'info');
    diagnostics.append('launch-a', 'two', 'stdout');
    diagnostics.append('launch-a', 'three', 'stderr');
    diagnostics.append('launch-a', 'four', 'stdout');

    const snapshot = diagnostics.snapshot();
    expect(snapshot.entries.map((entry) => entry.message)).toEqual([
      'two',
      'three',
      'four',
    ]);
    expect(snapshot.entries.map((entry) => entry.sequence)).toEqual([2, 3, 4]);
    expect(snapshot.truncated).toBe(true);
  });

  test('truncates oversized messages and never stores stale launch output', () => {
    const diagnostics = new LauncherDiagnostics({
      maxEntries: 10,
      maxBytes: 100,
      maxMessageBytes: 12,
    });

    diagnostics.begin('launch-a');
    diagnostics.append(
      'launch-a',
      '0123456789abcdefghijklmnopqrstuvwxyz',
      'stdout',
    );
    diagnostics.begin('launch-b');
    diagnostics.append('launch-a', 'stale', 'stderr');
    diagnostics.append('launch-b', 'current', 'info');

    const snapshot = diagnostics.snapshot();
    expect(snapshot.bridgeInstanceId).toBe('launch-b');
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].message).toBe('current');
  });

  test('returns stdout batches and rejects stale clear requests', () => {
    const diagnostics = new LauncherDiagnostics();
    diagnostics.begin('launch-a');

    const entries = diagnostics.appendOutput(
      'launch-a',
      Buffer.from('first\nsecond\n'),
      'stdout',
    );

    expect(entries.map((entry) => entry.message)).toEqual(['first', 'second']);
    expect(diagnostics.clear('launch-b')).toBe(false);
    expect(diagnostics.snapshot().entries).toHaveLength(2);
    expect(diagnostics.clear('launch-a')).toBe(true);
    expect(diagnostics.snapshot().entries).toHaveLength(0);
  });

  test('keeps only the requested tail of process output', () => {
    expect(appendTextTail('12345', '67890', 6)).toBe('567890');
    expect(appendTextTail('', Buffer.from('abcdef'), 4)).toBe('cdef');
    expect(
      Buffer.byteLength(appendTextTail('', '😀😀😀', 8)),
    ).toBeLessThanOrEqual(8);
  });
});
