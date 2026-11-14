import {
  formatInterval,
  presetRepeat,
  repeatPreset,
  scheduleLabel,
  tickReminders,
  reminderDueAt,
  scheduleError,
  withEditedOptions,
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
  ).toMatch(/at least 1 minute/);
});

test('custom repeats support any days, hours and minutes mix', () => {
  const repeat = presetRepeat('custom', 86_400_000 + 2 * 60_000);
  expect(repeat).toEqual({ every: 1442, unit: 'minute' });
  expect(scheduleLabel(repeat)).toBe('Every 1d 2m');
  expect(repeatPreset(repeat)).toBe('custom');
  expect(formatInterval(31 * 60_000)).toBe('31m');

  const { next } = tickReminders(
    [{ ...schedule, repeat: { every: 31, unit: 'minute' } }],
    110_000,
    100_000,
  );
  expect(next[0]).toMatchObject({ nextRunAt: 105_000 + 31 * 60_000 });
});

test('repeat presets recognise equal intervals and keep legacy units readable', () => {
  expect(repeatPreset({ every: 60, unit: 'minute' })).toBe('hour');
  expect(repeatPreset({ every: 1, unit: 'week' })).toBe('week');
  expect(repeatPreset({ every: 2, unit: 'week' })).toBe('custom');
  expect(scheduleLabel({ every: 2, unit: 'hour' })).toBe('Every 2h');
  expect(presetRepeat('never', 60_000)).toBeUndefined();
  expect(presetRepeat('day', 60_000)).toEqual({ every: 1, unit: 'day' });
});

test('only real option edits mark a cooldown as user-edited', () => {
  const plugin = { ...cooldown, options: { gamemode: 'prison' } };
  expect(withEditedOptions(plugin, { gamemode: 'prison' })).toBe(plugin);
  expect(withEditedOptions(cooldown, {})).toBe(cooldown);
  expect(withEditedOptions(plugin, { gamemode: 'skyblock' })).toEqual({
    ...plugin,
    options: { gamemode: 'skyblock' },
    optionsEdited: true,
  });
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
