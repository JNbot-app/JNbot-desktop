/** Shared, profile-scoped cooldowns and user-created schedules. */
type ReminderFields = {
  id: string;
  name: string;
  pluginId: string;
  reminderId?: string;
  cooldownId?: string;
  options?: Record<string, any>;
  autoStart?: boolean;
  join_delay?: number;
  join_delay_premium?: number;
};

export type ScriptCooldown = ReminderFields & {
  kind?: 'cooldown';
  cooldown: number;
  time: number;
};

export type ScheduleRepeat = { every: number; unit: 'hour' | 'day' | 'week' };
export type ScriptSchedule = ReminderFields & {
  kind: 'schedule';
  nextRunAt: number;
  repeat?: ScheduleRepeat;
};
export type Reminder = ScriptCooldown | ScriptSchedule;

const UNIT_MS = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 };

export function repeatInterval(repeat?: ScheduleRepeat): number {
  if (!repeat) return 0;
  const interval = UNIT_MS[repeat.unit] * repeat.every;
  return Number.isSafeInteger(repeat.every) &&
    repeat.every > 0 &&
    Number.isSafeInteger(interval) &&
    interval > 0
    ? interval
    : NaN;
}

export function reminderDueAt(reminder: Reminder): number {
  return reminder.kind === 'schedule'
    ? reminder.nextRunAt
    : reminder.time + reminder.cooldown;
}

/** Compact duration, e.g. "2d 5h", "3h 20m" or "12m". */
export function formatDuration(ms: number): string {
  const d = Math.floor(ms / UNIT_MS.day);
  const h = Math.floor((ms % UNIT_MS.day) / UNIT_MS.hour);
  const m = Math.floor((ms % UNIT_MS.hour) / 60_000);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

export function scheduleLabel(repeat?: ScheduleRepeat): string {
  return repeat
    ? `Every ${repeat.every} ${repeat.unit}${repeat.every === 1 ? '' : 's'}`
    : 'One-time run';
}

export function scheduleError(
  schedule: ScriptSchedule,
  now = Date.now(),
): string | undefined {
  if (!schedule.name.trim() || schedule.name.trim().length > 60)
    return 'Enter a name of 1–60 characters.';
  if (!schedule.pluginId) return 'Choose a script.';
  if (
    !Number.isSafeInteger(schedule.nextRunAt) ||
    schedule.nextRunAt <= now ||
    !Number.isFinite(new Date(schedule.nextRunAt).getTime())
  )
    return 'Choose a future date and time.';
  if (schedule.repeat && !Number.isFinite(repeatInterval(schedule.repeat)))
    return 'Use a positive whole-number repeat interval.';
  return undefined;
}

/** Consume occurrences before dispatch. A delayed/restarted runtime never catches up. */
export function tickReminders(
  reminders: Reminder[],
  now: number,
  previousTickAt: number,
) {
  const fired: Reminder[] = [];
  let changed = false;
  const next: Reminder[] = [];
  for (const reminder of reminders) {
    if (reminder.kind !== 'schedule') {
      if (reminder.autoStart && reminderDueAt(reminder) <= now) {
        fired.push(reminder);
        next.push({ ...reminder, time: now });
        changed = true;
      } else next.push(reminder);
      continue;
    }
    const dueAt = reminder.nextRunAt;
    const interval = repeatInterval(reminder.repeat);
    // Reject malformed persisted timing instead of executing it or producing NaN.
    if (
      !Number.isSafeInteger(dueAt) ||
      dueAt <= 0 ||
      !Number.isFinite(new Date(dueAt).getTime()) ||
      !Number.isFinite(interval) ||
      !reminder.pluginId ||
      dueAt > now
    ) {
      next.push(reminder);
      continue;
    }
    if (
      reminder.autoStart &&
      dueAt > previousTickAt &&
      now >= previousTickAt &&
      now - previousTickAt <= 30_000
    )
      fired.push(reminder);
    changed = true;
    if (interval) {
      const nextRunAt =
        dueAt + (Math.floor((now - dueAt) / interval) + 1) * interval;
      if (
        Number.isSafeInteger(nextRunAt) &&
        Number.isFinite(new Date(nextRunAt).getTime())
      )
        next.push({ ...reminder, nextRunAt });
    }
  }
  return { next, fired, changed };
}

export type RepeatPreset = 'never' | 'hour' | 'day' | 'week' | 'custom';
export const REPEAT_CHOICES = [
  { label: 'Never', value: 'never' },
  { label: 'Hourly', value: 'hour' },
  { label: 'Daily', value: 'day' },
  { label: 'Weekly', value: 'week' },
  { label: 'Custom', value: 'custom' },
];

export function repeatPreset(repeat?: ScheduleRepeat): RepeatPreset {
  if (!repeat) return 'never';
  return repeat.every === 1 ? repeat.unit : 'custom';
}

type OptionDefinition = {
  id: string;
  defaultValue?: unknown;
  valueByFieldId?: string;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Option drafts inherit live settings; only the changed field is persisted. */
export function overrideValue(
  option: OptionDefinition,
  definitions: OptionDefinition[],
  saved: Record<string, unknown>,
  overrides: Record<string, unknown>,
): unknown {
  const value = Object.prototype.hasOwnProperty.call(overrides, option.id)
    ? overrides[option.id]
    : saved[option.id];
  if (option.valueByFieldId && isRecord(value)) {
    const parent = definitions.find(
      (field) => field.id === option.valueByFieldId,
    );
    const selected = parent
      ? overrideValue(parent, [], saved, overrides)
      : undefined;
    const key = String(selected).toLowerCase();
    const inherited = saved[option.id];
    return (
      value[key] ??
      (isRecord(inherited) ? inherited[key] : undefined) ??
      option.defaultValue
    );
  }
  return value ?? option.defaultValue;
}

export function setOverride(
  option: OptionDefinition,
  value: unknown,
  definitions: OptionDefinition[],
  saved: Record<string, unknown>,
  overrides: Record<string, unknown>,
) {
  const parent = definitions.find(
    (field) => field.id === option.valueByFieldId,
  );
  const selected = parent
    ? overrideValue(parent, [], saved, overrides)
    : undefined;
  // A dependent field is keyed the same way as the existing script option editor.
  const existing = overrides[option.id];
  const persisted =
    selected !== undefined && selected !== null && selected !== ''
      ? {
          ...(isRecord(existing) ? existing : {}),
          [String(selected).toLowerCase()]: value,
        }
      : value;
  return { ...overrides, [option.id]: persisted };
}
