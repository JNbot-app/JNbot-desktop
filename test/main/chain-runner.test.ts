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
