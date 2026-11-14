import BotMachine, { patchedBotMachine } from '../../src/main/src/workers/bot/statemachines/BotMachine';

jest.mock('../../src/main/src/workers/bot/BotSession', () => ({ __esModule: true, default: class {} }));
jest.mock('../../src/main/src/workers/lib/workerScript', () => ({ __esModule: true, default: {} }));

const task = (name: string, run = jest.fn()) => ({ name, when: () => true, run });
const names = (machine: BotMachine) => (machine as any).tasks.map((t: any) => t.name);
const machines: BotMachine[] = [];
const create = (Machine: typeof BotMachine = BotMachine) => {
  const machine = new Machine([task('open'), task('deposit'), task('claim')], { delay: 0 });
  machines.push(machine);
  return machine;
};

afterEach(() => machines.splice(0).forEach((machine) => machine.finish()));

it('changes tasks by name', () => {
  const machine = create()
    .insertBefore('open', task('first'))
    .insertAfter('deposit', task('salvage'))
    .replaceTask('claim', task('claim all'))
    .removeTask('open');
  expect(names(machine)).toEqual(['first', 'deposit', 'salvage', 'claim all']);
  expect(() => machine.removeTask('open')).toThrow('no task named "open"');
});

it('wraps a task around its original run', async () => {
  const machine = create();
  const original = (machine as any).tasks[1].run;
  const calls: string[] = [];
  original.mockImplementation(() => calls.push('deposit'));
  machine.wrapTask('deposit', async (ctx, run) => {
    calls.push('salvage');
    await run(ctx);
  });
  await (machine as any).tasks[1].run({});
  expect(calls).toEqual(['salvage', 'deposit']);
});

it('patches each machine once, right before it starts', () => {
  const patches: Array<(machine: BotMachine<any>) => void> = [];
  const Machine = patchedBotMachine(patches);
  // Patches added after the plugin got its class still apply.
  patches.push((machine) => machine.insertAfter('open', task('salvage')));
  const machine = create(Machine);
  expect(names(machine)).toEqual(['open', 'deposit', 'claim']);
  machine.start();
  machine.finish();
  machine.start();
  expect(names(machine)).toEqual(['open', 'salvage', 'deposit', 'claim']);
});

it('refuses to start a machine its patch does not fit', () => {
  const machine = create(patchedBotMachine([(m) => m.removeTask('missing')]));
  expect(() => machine.start()).toThrow('no task named "missing"');
  expect(machine.active).toBe(false);
});
