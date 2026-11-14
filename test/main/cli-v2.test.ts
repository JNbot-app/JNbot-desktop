import { getRunnableScripts } from '../../src/cli/v2/actions';
import { OutputRouter, redact } from '../../src/cli/v2/output';
import { layoutForWidth } from '../../src/cli/v2/layout';
import { commandArguments } from '../../src/cli/v2/commandLine';
import {
  generateTerminalQr,
  generateTerminalQrLines,
  getRawQrGrid,
} from '../../src/cli/v2/qr';

describe('CLI v2 helpers', () => {
  it('selects a layout that works on narrow terminals', () => {
    expect(layoutForWidth(40)).toBe('compact');
    expect(layoutForWidth(60)).toBe('standard');
    expect(layoutForWidth(99)).toBe('standard');
    expect(layoutForWidth(100)).toBe('wide');
  });

  it('redacts remote-access and cloud secrets', () => {
    expect(redact('https://example.test?token=secret&room=abc')).toContain('token=[redacted]');
    expect(redact('shareKey=topsecret')).toContain('shareKey=[redacted]');
  });

  it('generates terminal QR codes for mobile and web deep links', () => {
    const mobileLink = 'jnbot://connect?room=room_123&token=tok_abc&id=dev_1';
    const qrString = generateTerminalQr(mobileLink);
    expect(qrString).toBeTruthy();
    expect(typeof qrString).toBe('string');
    expect(qrString.length).toBeGreaterThan(50);

    const qrLines = generateTerminalQrLines(mobileLink);
    expect(Array.isArray(qrLines)).toBe(true);
    expect(qrLines.length).toBeGreaterThan(10);
  });

  it('includes a four-module quiet zone around terminal QR codes', () => {
    const grid = getRawQrGrid('jnbot://connect?room=room_123&token=tok_abc&id=dev_1');
    expect(grid).not.toHaveLength(0);

    for (let index = 0; index < 4; index++) {
      expect(grid[index].every((module) => !module)).toBe(true);
      expect(grid[grid.length - 1 - index].every((module) => !module)).toBe(true);
      expect(grid.every((row) => !row[index])).toBe(true);
      expect(grid.every((row) => !row[row.length - 1 - index])).toBe(true);
    }
  });

  it('renders every QR module as a square terminal cell', () => {
    const text = 'jnbot://connect?room=room_123&token=tok_abc&id=dev_1';
    const grid = getRawQrGrid(text);
    const lines = generateTerminalQrLines(text);

    expect(lines).toHaveLength(grid.length);
    for (const [rowIndex, row] of grid.entries()) {
      expect(lines[rowIndex]).toHaveLength(row.length * 2);
      for (const [columnIndex, module] of row.entries()) {
        expect(lines[rowIndex].slice(columnIndex * 2, columnIndex * 2 + 2)).toBe(
          module ? '██' : '  ',
        );
      }
    }
  });

  it('handles empty input gracefully in QR generator', () => {
    expect(generateTerminalQr('')).toBe('');
    expect(generateTerminalQrLines('')).toEqual([]);
  });

  it('keeps activity bounded', () => {
    const output = new OutputRouter();
    for (let index = 0; index < 510; index++) {
      output.push({ timestamp: index, severity: 'info', source: 'test', message: String(index) });
    }
    expect(output.list()).toHaveLength(500);
    expect(output.list()[0].message).toBe('10');
  });

  it('omits derived account-worth messages from terminal logs', () => {
    const output = new OutputRouter();
    output.install();
    console.info('Total account worth: 590');
    console.info('Connected to server');
    output.restore();
    expect(output.list().map((event) => event.message)).toEqual(['Connected to server']);
  });

  it('turns script-console entries into output events', () => {
    const output = new OutputRouter();
    output.pushScriptLog(['Joined the server', 3, 'Chat', 'chat', 42]);
    expect(output.list()).toEqual([{
      timestamp: 42,
      severity: 'success',
      source: 'script:Chat',
      message: 'Joined the server',
    }]);
  });

  it('bounds large objects captured from the process console', () => {
    const output = new OutputRouter();
    output.install();
    try {
      console.log({ items: Array.from({ length: 50_000 }, (_, id) => id) });
    } finally {
      output.restore();
    }
    expect(Buffer.byteLength(output.list()[0].message)).toBeLessThanOrEqual(8 * 1024);
    expect(output.list()[0].message).toContain('truncated');
  });

  it('parses palette commands with an optional prefix and quoted values', () => {
    expect(commandArguments('jnbot plugin run "My plugin"')).toEqual([
      'plugin', 'run', 'My plugin',
    ]);
    expect(commandArguments("profile use 'jartex network'")).toEqual([
      'profile', 'use', 'jartex network',
    ]);
  });
});

describe('getRunnableScripts', () => {
  const info = (pluginId: string, scriptType = 'script') => ({ pluginId, name: pluginId, scriptType });
  const runtime = {
    handler: {
      getBootstrapRuntime: () => ({ profileId: 1, profileKey: 'p' }),
      isPluginDisallowed: (_: number, id: string) => id === 'blocked',
      macros: {
        toList: () => [info('shared', 'action'), info('library'), info('blocked'), info('ui', 'profileUi')],
      },
      settings: {
        JNdata: { data: { p: { scripts: [{ id: 's1', pluginId: 'shared' }, { id: 's2', pluginId: 'broken' }] } } },
        profiles: {
          scripts: {
            resolveInfo: async ({ id }: { id: string }) =>
              id === 's1' ? { info: info('shared', 'action') } : { error: 'Failed' },
          },
        },
        getProfileSettings: () => ({
          scripts: { chains: { c1: { id: 'c1', chains: [], name: 'Old' } }, c1: { name: 'Daily' } },
        }),
      },
    },
  } as any;

  it('lists runnable scripts once, with profile scripts first and chains last', async () => {
    const scripts = await getRunnableScripts(runtime);
    expect(scripts.map(({ info: { pluginId }, profileScriptId }) => [pluginId, profileScriptId])).toEqual([
      ['shared', 's1'],
      ['library', undefined],
      ['chain:c1', undefined],
    ]);
    expect(scripts[2].info.name).toBe('Daily');
  });
});
