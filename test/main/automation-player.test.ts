import { AutomationPlayer, type AutomationExecutionContext, type AutomationTargetAdapter } from '../../src/common/AutomationPlayer';
import type { AutomationDocument, AutomationReplayOptions, AutomationStep } from '../../src/common/automation';

const document = (steps: AutomationStep[]): AutomationDocument => ({
  schemaVersion: 2, id: 'test-automation', name: 'Test automation', revision: 0,
  createdAt: 1, updatedAt: 1, durationMs: steps.at(-1)?.atMs ?? 0,
  source: { kind: 'minecraft' }, origin: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 }, inputs: [], steps,
});
const step = (id: string, atMs: number): AutomationStep => ({ id, enabled: true, atMs, kind: 'chat', message: id });
class Adapter implements AutomationTargetAdapter {
  readonly target = { kind: 'minecraft' as const, id: 'client' };
  readonly executed: string[] = [];
  prepareError?: Error;
  failures = 0;
  async prepare(_document: AutomationDocument, _options: AutomationReplayOptions) { if (this.prepareError) throw this.prepareError; return { x: 0, y: 64, z: 0 }; }
  async execute(value: AutomationStep, _context: AutomationExecutionContext) { if (this.failures-- > 0) throw new Error('Action was unavailable'); this.executed.push(value.id); }
  async pause() {}
  async resume() {}
  async stop() {}
}
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };

describe('AutomationPlayer v2', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('uses recording timestamps and executes overdue actions immediately', async () => {
    const adapter = new Adapter();
    const player = new AutomationPlayer(document([step('one', 100), step('two', 200)]), adapter, { spatialMode: 'relative' });
    await flush();
    jest.advanceTimersByTime(99); await flush(); expect(adapter.executed).toEqual([]);
    jest.advanceTimersByTime(1); await flush(); expect(adapter.executed).toEqual(['one']);
    jest.advanceTimersByTime(100); await flush(); expect(adapter.executed).toEqual(['one', 'two']);
    await expect(player.done).resolves.toMatchObject({ state: 'completed', issues: [] });
  });

  test('does not consume a timestamp gap while paused', async () => {
    const adapter = new Adapter();
    const player = new AutomationPlayer(document([step('one', 200)]), adapter, { spatialMode: 'relative' });
    await flush(); jest.advanceTimersByTime(50); await flush();
    await player.pause(); jest.advanceTimersByTime(1_000); await flush(); await player.resume(); await flush();
    jest.advanceTimersByTime(149); await flush(); expect(adapter.executed).toEqual([]);
    jest.advanceTimersByTime(1); await flush(); expect(adapter.executed).toEqual(['one']);
  });

  test('records a failed action and continues instead of pausing', async () => {
    const adapter = new Adapter(); adapter.failures = 1;
    const player = new AutomationPlayer(document([step('missing', 0), step('later', 0)]), adapter, { spatialMode: 'relative' });
    await flush();
    await expect(player.done).resolves.toMatchObject({ state: 'completed', currentStep: 2, issues: [expect.objectContaining({ stepId: 'missing', reason: 'Action was unavailable' })] });
    expect(adapter.executed).toEqual(['later']);
  });

  test('keeps preparation failures terminal', async () => {
    const adapter = new Adapter(); adapter.prepareError = new Error('Wrong starting position');
    const player = new AutomationPlayer(document([step('one', 0)]), adapter, { spatialMode: 'absolute' });
    await flush();
    await expect(player.done).resolves.toMatchObject({ state: 'failed', error: 'Wrong starting position' });
  });
});
