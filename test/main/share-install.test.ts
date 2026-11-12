import { shareInstallKey, shareInstallState, type InstalledShare } from '../../src/common/share';
import { SHARE_KIND_HANDLERS, type Envelope, type ShareContext } from '../../src/main/src/functions/share/ShareKinds';

/** Profile settings with `updateProfileSettings` applying path writes, like Settings does. */
function fakeContext(settings: Record<string, any>): ShareContext {
  const write = (target: any, path: string[], value: unknown) => {
    const last = path.at(-1)!;
    const parent = path.slice(0, -1).reduce((node, key) => (node[key] ??= {}), target);
    parent[last] = value;
  };
  return {
    settings: {
      JNdata: { data: {} },
      getProfileSettings: () => settings,
      updateProfileSettings: (_key: string, changes: any) => {
        for (const { path, value } of [changes].flat()) write(settings, path, value);
      },
    },
    macros: { findPlugin: () => null },
  } as unknown as ShareContext;
}

const envelope = (kind: Envelope['kind'], payload: unknown) =>
  ({ kind, payload, plugins: [], meta: { servers: [] } }) as unknown as Envelope;

describe('share installs', () => {
  test('tracks chains and triggers per profile', () => {
    expect(shareInstallKey('AAAAAAAAAA', 'plugin', 'jartex')).toBe('AAAAAAAAAA');
    expect(shareInstallKey('AAAAAAAAAA', 'chain', 'jartex')).not.toBe(shareInstallKey('AAAAAAAAAA', 'chain', 'pika'));
  });

  test('own shares are never offered for install', () => {
    const install = { revision: 'a', latestRevision: 'a' } as InstalledShare;
    expect(shareInstallState(undefined, 'a', '1.0.0', '1.0.0', true)).toBe('own');
    expect(shareInstallState(install, 'a', '1.0.0', '1.0.0', false)).toBe('installed');
    expect(shareInstallState(install, 'b', '1.0.0', '1.0.0', false)).toBe('update');
  });

  test('a trigger update replaces it in place and keeps your settings', async () => {
    const settings: Record<string, any> = { triggers: [] };
    const ctx = fakeContext(settings);
    const shared = (message: string) =>
      envelope('trigger', {
        triggers: [{ event: 'chat', actions: [{ type: 'discord' }, { type: 'chat', message }] }],
      });
    const id = await SHARE_KIND_HANDLERS.trigger.install(shared('v1'), { id: 'x', decisions: [], profileKey: 'p' }, ctx);
    Object.assign(settings.triggers[0], { enabled: false, alts: ['bob'] });
    settings.triggers[0].actions[0].webhook = 'https://hook';
    const again = await SHARE_KIND_HANDLERS.trigger.install(
      shared('v2'),
      { id: 'x', decisions: [], profileKey: 'p', existingRef: id },
      ctx,
    );
    expect(again).toBe(id);
    expect(settings.triggers).toHaveLength(1);
    expect(settings.triggers[0]).toMatchObject({
      enabled: false,
      alts: ['bob'],
      actions: [{ type: 'discord', webhook: 'https://hook' }, { type: 'chat', message: 'v2' }],
    });
  });

  test('a chain update keeps its id and your options', async () => {
    const settings: Record<string, any> = { scripts: {} };
    const ctx = fakeContext(settings);
    const shared = (name: string) =>
      envelope('chain', { name, steps: [{ id: '1', name: 'Step', scriptId: 'plugin' }] });
    const id = await SHARE_KIND_HANDLERS.chain.install(shared('v1'), { id: 'x', decisions: [], profileKey: 'p' }, ctx);
    settings.scripts[id].altRange = [1, 5];
    const again = await SHARE_KIND_HANDLERS.chain.install(
      shared('v2'),
      { id: 'x', decisions: [], profileKey: 'p', existingRef: id },
      ctx,
    );
    expect(again).toBe(id);
    expect(Object.keys(settings.scripts.chains)).toEqual([id]);
    expect(settings.scripts[id]).toMatchObject({ name: 'v2', altRange: [1, 5] });
  });

  test('a chain brings its setup code along, shown before installing', async () => {
    const setup = "chain.setOptions('Kit Collector', { itemTransfer: 'keep' });";
    const from = fakeContext({
      scripts: { chains: { c: { id: 'c', chains: [{ id: '1', name: 'Kits', scriptId: 'kits' }], setup } }, c: { name: 'Kits' } },
    });
    const built = await SHARE_KIND_HANDLERS.chain.build('c', from, 'p');
    const shared = envelope('chain', built.payload);
    expect(SHARE_KIND_HANDLERS.chain.describe!(shared).find((section) => section.code)?.code).toBe(setup);

    const settings: Record<string, any> = { scripts: {} };
    const id = await SHARE_KIND_HANDLERS.chain.install(shared, { id: 'x', decisions: [], profileKey: 'p' }, fakeContext(settings));
    expect(settings.scripts.chains[id].setup).toBe(setup);

    const broken = envelope('chain', { ...(built.payload as object), setup: { code: setup } });
    await expect(
      SHARE_KIND_HANDLERS.chain.install(broken, { id: 'y', decisions: [], profileKey: 'p' }, fakeContext({ scripts: {} })),
    ).rejects.toThrow('Invalid chain share.');
  });
});
