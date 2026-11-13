import type { Chain } from '../../src/common/chains';

const runAction = jest.fn();
const bots = [
  { username: 'alt1', isOnline: () => true },
  { username: 'alt2', isOnline: () => true },
];

jest.mock('../../src/main/src/workers/compiler/scriptActions', () => runAction);
jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  __esModule: true,
  default: { getAlts: () => [], stop: jest.fn() },
}));
// Setup code is the body of `main(chain, bot)`; run it as a real function.
jest.mock('../../src/main/src/workers/compiler/jsRuntime', () => ({
  runJS: async ({ code, args }: { code: string; args: unknown[] }) =>
    // eslint-disable-next-line no-new-func
    new Function(`${code}; return main;`)()(...args),
}));
jest.mock('../../src/main/src/workers/scripts/iterateAlts', () => ({
  iterateBots: async function* () {
    for (const bot of bots) yield bot;
  },
}));

import runChain from '../../src/main/src/workers/scripts/chains/runChain';

const chain = (steps: Chain['chains']): Chain => ({
  id: 'c1',
  chains: steps,
  options: { name: 'Daily', gamemode: 'any' },
});

beforeEach(() => {
  runAction.mockReset();
  (global as any).log = jest.fn();
});

const ranSteps = () => runAction.mock.calls.map(([req]) => `${req.bot.username}:${req.id}`);

it('passes returned values to later steps and fills placeholders', async () => {
  runAction.mockImplementation(async ({ id }) => (id === 'a' ? { coins: 5 } : undefined));
  await runChain(
    chain([
      { id: '1', name: 'A', scriptId: 'a' },
      { id: '2', name: 'B', scriptId: 'b', options: { message: '{alt} has {coins}' } },
    ]),
  );
  const second = runAction.mock.calls[1][0];
  expect(second.args[0]).toMatchObject({ alt: 'alt1', coins: 5 });
  expect(second.optionOverrides).toEqual({ message: 'alt1 has 5' });
});

it('jumps to another step when a step fails', async () => {
  runAction.mockImplementation(async ({ id }) => {
    if (id === 'a') throw new Error('boom');
  });
  await runChain(
    chain([
      { id: '1', name: 'A', scriptId: 'a', onFail: 'step:3' },
      { id: '2', name: 'B', scriptId: 'b' },
      { id: '3', name: 'C', scriptId: 'c' },
    ]),
  );
  expect(ranSteps()).toEqual(['alt1:a', 'alt1:c', 'alt2:a', 'alt2:c']);
});

it('skips to the next alt, or stops the chain', async () => {
  runAction.mockImplementation(async ({ id }) => id !== 'a');
  await runChain(
    chain([
      { id: '1', name: 'A', scriptId: 'a', onFail: 'nextAlt' },
      { id: '2', name: 'B', scriptId: 'b', onSuccess: 'stop' },
    ]),
  );
  expect(ranSteps()).toEqual(['alt1:a', 'alt2:a']);

  runAction.mockResolvedValue(undefined);
  await runChain(
    chain([
      { id: '1', name: 'A', scriptId: 'a', onSuccess: 'stop' },
      { id: '2', name: 'B', scriptId: 'b' },
    ]),
  );
  expect(ranSteps().slice(2)).toEqual(['alt1:a']);
});

it('runs a step on the preset it picked', async () => {
  await runChain(
    chain([{ id: '1', name: 'A', scriptId: 'a', options: { $preset: 'second' } }]),
  );
  expect(runAction.mock.calls[0][0].optionOverrides).toEqual({ $preset: 'second' });
});

describe('chain API', () => {
  /** Run `orchestrate(chain)` as the step with scriptId `setup`; other steps return their id. */
  const withSetup = (orchestrate: (api: any, req: any) => unknown) =>
    runAction.mockImplementation(async (req) =>
      req.id === 'setup' ? orchestrate(req.context.chain, req) : undefined,
    );

  const steps: Chain['chains'] = [
    { id: '1', name: 'Setup', scriptId: 'setup' },
    { id: '2', name: 'Kit Collector', scriptId: 'kits', options: { transfer: 'keep' } },
    { id: '3', name: 'Auto Salvage', scriptId: 'salvage', options: { trash: 'yes', for: '{alt}' } },
  ];

  it('runs a disabled step only when asked, with extra options on top', async () => {
    withSetup(async (api) => {
      api.disableStep('Auto Salvage');
      expect(api.steps.map((s: any) => s.enabled)).toEqual([true, true, false]);
      expect(api.current).toMatchObject({ name: 'Setup' });
      await expect(api.runStep('3', { trash: 'no' })).resolves.toBe(true);
    });
    await runChain(chain(steps));
    expect(ranSteps()).toEqual(['alt1:setup', 'alt1:salvage', 'alt1:kits', 'alt2:setup', 'alt2:salvage', 'alt2:kits']);
    expect(runAction.mock.calls[1][0].optionOverrides).toEqual({ trash: 'no', for: 'alt1' });
  });

  it('hands patches to the step they are for, for this alt only', async () => {
    const patch = jest.fn();
    let alt = 0;
    withSetup((api) => {
      if (alt++ === 0) api.patch('Kit Collector', patch);
    });
    await runChain(chain(steps));
    const patchesOf = (id: string) => runAction.mock.calls.filter(([req]) => req.id === id).map(([req]) => req.context.patches);
    expect(patchesOf('kits')).toEqual([[patch], []]);
    expect(patchesOf('salvage')).toEqual([[], []]);
  });

  it('adds steps and decides where to go next', async () => {
    withSetup((api, req) => {
      if (req.bot.username === 'alt1') {
        api.addStep({ scriptId: 'extra', name: 'Extra' }, 'Setup');
        api.goTo('Auto Salvage');
      } else api.stop();
    });
    await runChain(chain(steps));
    expect(ranSteps()).toEqual(['alt1:setup', 'alt1:salvage', 'alt2:setup']);
  });

  it('fails a step that refers to a step that does not exist', async () => {
    withSetup((api) => api.disableStep('Nope'));
    await runChain(chain(steps.slice(0, 1)));
    expect(global.log).toHaveBeenCalledWith(expect.stringContaining('no step "Nope"'), 'error');
  });

  it('always runs a step with the options set for it, under those of runStep', async () => {
    withSetup(async (api) => {
      api.setOptions('Kit Collector', { transfer: 'keep', note: '{alt}' });
      api.setOptions('Kit Collector', { kits: 'all' });
      expect(api.steps[1].options).toEqual({ transfer: 'keep', note: '{alt}', kits: 'all' });
      await api.runStep('Kit Collector', { kits: 'some' });
    });
    await runChain(chain(steps.slice(0, 2)));
    const kits = runAction.mock.calls.filter(([req]) => req.id === 'kits').map(([req]) => req.optionOverrides);
    expect(kits[0]).toEqual({ transfer: 'keep', note: 'alt1', kits: 'some' });
    expect(kits[1]).toEqual({ transfer: 'keep', note: 'alt1', kits: 'all' });
  });

  it("runs the chain's setup code for each alt before the steps", async () => {
    runAction.mockResolvedValue(undefined);
    await runChain({
      ...chain(steps.slice(1)),
      setup: "chain.setOptions('Kit Collector', { transfer: bot.username }); chain.disableStep('3');",
    });
    expect(ranSteps()).toEqual(['alt1:kits', 'alt2:kits']);
    expect(runAction.mock.calls.map(([req]) => req.optionOverrides.transfer)).toEqual(['alt1', 'alt2']);
  });

  it("gives the setup code the chain's own options, with their defaults", async () => {
    runAction.mockResolvedValue(undefined);
    const options = { name: 'Daily', gamemode: 'any', transfer: 'gift' } as Chain['options'];
    await runChain({
      ...chain(steps.slice(1)),
      options,
      config: [
        {
          name: 'General',
          options: [
            { id: 'transfer', label: 'Transfer', type: 'input' },
            { id: 'salvage', label: 'Salvage', type: 'switch', defaultValue: false },
          ],
        },
      ],
      setup: "chain.setOptions('Kit Collector', { transfer: options.transfer }); if (!options.salvage) chain.disableStep('3');",
    });
    expect(ranSteps()).toEqual(['alt1:kits', 'alt2:kits']);
    expect(runAction.mock.calls[0][0].optionOverrides.transfer).toBe('gift');
  });

  it('stops the chain when its setup code throws', async () => {
    await runChain({ ...chain(steps.slice(1)), setup: 'chain.setOptions("Nope", {});' });
    expect(ranSteps()).toEqual([]);
    expect(global.log).toHaveBeenCalledWith(expect.stringContaining('setup code failed'), 'error');
  });
});
