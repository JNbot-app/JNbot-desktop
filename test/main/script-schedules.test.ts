import BotEvents from '../../src/main/src/functions/BotEvents';
import ScriptHandler from '../../src/main/src/functions/ScriptHandler';
import type { Reminder, ScriptSchedule } from '../../src/common/cooldowns';

const schedule: ScriptSchedule = {
  kind: 'schedule',
  id: 'user-schedule',
  name: 'Mining',
  pluginId: 'miner',
  nextRunAt: 105_000,
  autoStart: true,
  options: { gamemode: 'skyblock' },
};

function fixture(initial: Reminder[] = [schedule]) {
  const settings = { reminders: initial };
  const calls: string[] = [];
  const storage = {
    getProfileSettings: jest.fn(() => settings),
    updateProfileSettings: jest.fn((_key, patch) => {
      calls.push('persist');
      settings.reminders = patch.value;
    }),
  };
  const runtime = {
    profileKey: 'profile-a',
    cooldownLastTickAt: 100_000,
    activeScripts: {
      getScriptsByScriptId: jest.fn(() => [{ stop: () => calls.push('stop') }]),
    },
  };
  const handler = Object.assign(Object.create(ScriptHandler.prototype), {
    settings: storage,
    getRuntime: jest.fn(() => runtime),
    isPluginDisallowed: jest.fn(() => false),
    runByPluginId: jest.fn(async () => {
      calls.push('run');
      return true;
    }),
  });
  const events = Object.assign(Object.create(BotEvents.prototype), {
    script: { profile: runtime, scriptHandler: handler },
  });
  return { settings, handler, runtime, events, calls, storage };
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(110_000);
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('persists consumption in the owning profile before stopping/starting a script', () => {
  const f = fixture();
  Reflect.get(f.handler, 'tickCooldowns').call(f.handler, 7);
  expect(f.calls).toEqual(['persist', 'stop', 'run']);
  expect(f.storage.updateProfileSettings).toHaveBeenCalledWith('profile-a', {
    path: ['reminders'],
    value: [],
  });
  expect(f.handler.runByPluginId).toHaveBeenCalledWith(7, 'miner', {
    gamemode: 'skyblock',
  });
  Reflect.get(f.handler, 'tickCooldowns').call(f.handler, 7);
  expect(f.handler.runByPluginId).toHaveBeenCalledTimes(1);
});

test('profile-disallowed scripts are consumed without execution or stopping another run', () => {
  const f = fixture();
  f.handler.isPluginDisallowed.mockReturnValue(true);
  Reflect.get(f.handler, 'tickCooldowns').call(f.handler, 7);
  expect(f.calls).toEqual(['persist']);
});

test('execution failure is reported and never retries the consumed occurrence', async () => {
  const f = fixture();
  const error = new Error('Unavailable script');
  f.handler.runByPluginId.mockRejectedValue(error);
  const logger = jest.spyOn(console, 'error').mockImplementation(() => {});
  Reflect.get(f.handler, 'tickCooldowns').call(f.handler, 7);
  await Promise.resolve();
  expect(logger).toHaveBeenCalledWith(
    '[ScriptHandler] Scheduled run failed:',
    'miner',
    error,
  );
  expect(f.settings.reminders).toEqual([]);
});

test('script cooldown API cannot see, reset, overwrite, or remove user schedules', () => {
  const f = fixture([{ ...schedule, reminderId: 'same' }]);
  expect(f.events.COOLDOWN_GET('miner')).toEqual([]);
  expect(
    f.events.COOLDOWN_RESET({ id: schedule.id, pluginId: 'miner' }).ok,
  ).toBe(false);
  expect(
    f.events.COOLDOWN_REMOVE({ id: schedule.id, pluginId: 'miner' }).ok,
  ).toBe(false);
  expect(
    f.events.COOLDOWN_ADD({
      pluginId: 'miner',
      reminder: {
        reminderId: 'same',
        name: 'Mining cooldown',
        cooldown: 60_000,
      },
    }).ok,
  ).toBe(true);
  expect(f.settings.reminders[0]).toEqual({ ...schedule, reminderId: 'same' });
  expect(f.events.COOLDOWN_GET('miner')).toHaveLength(1);
});

test('user schedules do not count toward the script cooldown cap', () => {
  const f = fixture(
    Array.from({ length: 10 }, (_, index) => ({
      ...schedule,
      id: `schedule-${index}`,
    })),
  );
  expect(
    f.events.COOLDOWN_ADD({
      pluginId: 'miner',
      reminder: { name: 'Mining cooldown', cooldown: 60_000 },
    }).ok,
  ).toBe(true);
  expect(f.settings.reminders).toHaveLength(11);
});
