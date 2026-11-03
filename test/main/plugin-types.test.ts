/**
 * Profile-specific plugin entry points:
 *
 *  - botExtension → loaded into a bot worker as the last plugin via
 *    `createBotExtension`. Full execution needs a bot/join; this test checks
 *    that the plugin invokes the action runner with the expected arguments.
 *
 *  - profileUi → executed by `ProfileUiRunner` in a sandboxed `vm` in the
 *    main process. We drive the REAL runner with the plugin storage/resolver
 *    stubbed, so the actual vm + Builder API + JSON sanitisation all run.
 *
 * The profile UI test transpiles TS fixtures with native esbuild so it stays
 * independent of the esbuild-wasm asset.
 */
import esbuild from 'esbuild';
import { bootElectron, freshUserData, cleanupUserData } from './helpers';

afterAll(cleanupUserData);

const ts = (code: string): string =>
  esbuild.transformSync(code, { loader: 'ts', format: 'cjs' }).code;

// ---------------------------------------------------------------------------
// botExtension
// ---------------------------------------------------------------------------
jest.mock('../../src/main/src/workers/compiler/jsRuntime', () => ({
  runJS: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/main/src/workers/bot/plugin/resolvePluginOptions', () => ({
  resolvePluginOptions: jest.fn(() => ({ message: 'configured' })),
}));

describe('botExtension: action runtime', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createBotExtension } = require('../../src/main/src/workers/bot/extensions/botExtension.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runJS } = require('../../src/main/src/workers/compiler/jsRuntime');

  test('empty code does not install a plugin', () => {
    expect(createBotExtension(undefined)).toBeNull();
    expect(createBotExtension({ code: '' })).toBeNull();
  });

  test('profile action runs with the normal action arguments and settings', () => {
    const info = { name: 'Profile action', pluginId: 'profile-action', scriptType: 'action', language: 'js' };
    const code = 'async function main(bot, settings, args) { bot.chat(settings.message); }';
    const plugin = createBotExtension({ code, info });
    const bot = { chat: jest.fn() };
    plugin(bot);
    expect(runJS).toHaveBeenCalledWith({
      code,
      scriptInfo: info,
      scriptOptions: { message: 'configured' },
      args: [bot, { message: 'configured' }, []],
      runAsAction: true,
      allowExportedMain: true,
      useWorkerRealm: true,
      extraGlobals: {
        __dirname: expect.any(String),
        __filename: expect.any(String),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// profileUi
// ---------------------------------------------------------------------------
describe('profileUi: ProfileUiRunner vm execution', () => {
  function bootRunner(opts: {
    code: string;
    language?: 'js' | 'ts';
    checksumOk?: boolean;
  }) {
    const electron = bootElectron(freshUserData());
    const settings = {
      shared: { alts: [{ username: 'Steve', UID: null }] },
      activeServer: 'srv',
      settings: { altData: {} },
      getProfileSettings: () => ({ altData: {} }),
      stats: { stats: {} },
      profiles: { get: () => null },
    };
    const scripts = {
      resolve: async () => ({
        code: { code: opts.code },
        checksumOk: opts.checksumOk ?? true,
        info: { language: opts.language ?? 'js' },
      }),
    };
    const ProfileUiRunner =
      require('../../src/main/src/functions/ProfileUiRunner').default;
    new ProfileUiRunner(settings, scripts);
    return electron;
  }

  const preview = (electron: any) =>
    electron.ipcMain.__invoke('profile-ui-preview', {
      script: { source: 'plugin', scriptId: 'x' },
      username: 'Steve',
      server: 'srv',
    });

  test('a builder-based action returns valid UI JSON', async () => {
    const electron = bootRunner({
      code: `function main(args) {
        const p = new ProfileBuilder();
        p.player({ username: args.username });
        p.identity('left').badge('VIP', 'gold');
        return p.build();
      }`,
    });
    const res = await preview(electron);
    expect(res.ok).toBe(true);
    expect(res.json.player.username).toBe('Steve');
    expect(res.json.sections.length).toBeGreaterThan(0);
  });

  test('an action returning a plain literal is sanitised + accepted', async () => {
    const electron = bootRunner({
      code: `function main(args) {
        return { player: { username: args.username }, sections: [] };
      }`,
    });
    const res = await preview(electron);
    expect(res.ok).toBe(true);
    expect(res.json.player.username).toBe('Steve');
  });

  test('checksum mismatch is rejected (no execution)', async () => {
    const electron = bootRunner({
      code: 'function main() { return {}; }',
      checksumOk: false,
    });
    const res = await preview(electron);
    expect(res.ok).toBe(false);
  });

  test('action that returns garbage → ok:false (invalid UI JSON)', async () => {
    const electron = bootRunner({
      code: 'function main() { return 12345; }',
    });
    const res = await preview(electron);
    expect(res.ok).toBe(false);
  });

  test('action that throws → ok:false (caught, not a crash)', async () => {
    const electron = bootRunner({
      code: 'function main() { throw new Error("kaboom"); }',
    });
    const res = await preview(electron);
    expect(res.ok).toBe(false);
  });
});
