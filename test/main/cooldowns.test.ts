import {
  tickReminders,
  reminderDueAt,
  scheduleError,
  setOverride,
  overrideValue,
  type ScriptSchedule,
  type ScriptCooldown,
} from '../../src/common/cooldowns';

const schedule: ScriptSchedule = {
  kind: 'schedule',
  id: 'schedule',
  name: 'Mining',
  pluginId: 'miner',
  nextRunAt: 105_000,
  autoStart: true,
};
const cooldown: ScriptCooldown = {
  id: 'cooldown',
  name: 'Mining',
  pluginId: 'miner',
  time: 0,
  cooldown: 100_000,
  autoStart: true,
};

test('consumes a one-time occurrence once and retains legacy cooldown behavior', () => {
  const result = tickReminders([schedule, cooldown], 110_000, 100_000);
  expect(result.fired).toEqual([schedule, cooldown]);
  expect(result.next).toEqual([{ ...cooldown, time: 110_000 }]);
  expect(tickReminders(result.next, 120_000, 110_000).fired).toEqual([]);
  expect(reminderDueAt(schedule)).toBe(105_000);
});

test('custom repeats advance from their anchor rather than the delayed tick', () => {
  const repeating = {
    ...schedule,
    repeat: { every: 2, unit: 'hour' as const },
  };
  expect(tickReminders([repeating], 110_000, 100_000).next).toEqual([
    { ...repeating, nextRunAt: 7_305_000 },
  ]);
});

test.each([
  ['restart', 110_000, 110_000],
  ['suspension', 200_000, 100_000],
  ['overdue on enable', 110_000, 108_000],
])('skips a missed one-time run after %s', (_reason, now, previous) => {
  expect(tickReminders([schedule], now, previous)).toEqual({
    fired: [],
    next: [],
    changed: true,
  });
});

test('skips many missed repeats in one step and re-arms after restart', () => {
  const repeating = { ...schedule, repeat: { every: 1, unit: 'day' as const } };
  const result = tickReminders([repeating], 259_310_000, 259_300_000);
  expect(result.fired).toEqual([]);
  expect(result.next).toEqual([{ ...repeating, nextRunAt: 345_705_000 }]);
  expect(
    tickReminders(result.next, 345_710_000, 345_700_000).fired,
  ).toHaveLength(1);
});

test('paused schedules consume occurrences without dispatching', () => {
  expect(
    tickReminders([{ ...schedule, autoStart: false }], 110_000, 100_000).fired,
  ).toEqual([]);
  const repeating = {
    ...schedule,
    autoStart: false,
    repeat: { every: 1, unit: 'week' as const },
  };
  expect(tickReminders([repeating], 110_000, 100_000).next).toEqual([
    { ...repeating, nextRunAt: 604_905_000 },
  ]);
});

test.each([NaN, Infinity, -1, 1.5])(
  'invalid persisted timestamps never execute (%s)',
  (nextRunAt) => {
    expect(
      tickReminders([{ ...schedule, nextRunAt }], 110_000, 100_000).fired,
    ).toEqual([]);
  },
);

test.each([0, -1, 0.5, Infinity])(
  'invalid repeat intervals never execute (%s)',
  (every) => {
    expect(
      tickReminders(
        [{ ...schedule, repeat: { every, unit: 'hour' } }],
        110_000,
        100_000,
      ).fired,
    ).toEqual([]);
  },
);

test('editor validation rejects past dates and invalid intervals', () => {
  expect(scheduleError(schedule, 100_000)).toBeUndefined();
  expect(scheduleError(schedule, 110_000)).toMatch(/future/);
  expect(
    scheduleError({ ...schedule, repeat: { every: 0, unit: 'hour' } }, 100_000),
  ).toMatch(/whole-number/);
});

test('override drafts inherit saved fields without copying them into overrides', () => {
  const fields = [
    { id: 'gamemode', defaultValue: 'prison' },
    { id: 'alts', valueByFieldId: 'gamemode' },
  ];
  const saved = { gamemode: 'skyblock', alts: { skyblock: ['A'] } };
  const overrides = setOverride(fields[1], ['B'], fields, saved, {});
  expect(overrides).toEqual({ alts: { skyblock: ['B'] } });
  expect(overrideValue(fields[1], fields, saved, overrides)).toEqual(['B']);
  expect(overrideValue(fields[1], fields, saved, {})).toEqual(['A']);
});
