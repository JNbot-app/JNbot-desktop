/**
 * Fixed-size weekly buckets for dashboard trends. Each series holds at most
 * HISTORY_WEEKS values (oldest → newest, last one is `week`), so stats.json
 * never grows with usage time.
 */
export const HISTORY_WEEKS = 10;

export type WeeklySeries = { week: number; values: number[] };

const DAY = 86_400_000;

/** Local-time week number; weeks start on Monday (epoch day 0 was a Thursday). */
export function weekIndex(now = Date.now()): number {
  const local = now - new Date(now).getTimezoneOffset() * 60_000;
  return Math.floor((local / DAY + 3) / 7);
}

/** Values shifted so the last one belongs to `week`; skipped weeks are 0. */
export function alignSeries(series: WeeklySeries | undefined, week = weekIndex()): number[] {
  const values = Array.isArray(series?.values) ? series.values : [];
  const gap = Math.min(Math.max(0, week - (series?.week ?? week)), HISTORY_WEEKS);
  if (!gap) return values;
  return values.concat(Array(gap).fill(0)).slice(-HISTORY_WEEKS);
}

/** New series with the current week's value replaced by `update(current)`. */
export function recordWeekly(
  series: WeeklySeries | undefined,
  update: (current: number) => number,
  now = Date.now(),
): WeeklySeries {
  const week = weekIndex(now);
  const values = alignSeries(series, week).slice();
  if (!values.length) values.push(0);
  values[values.length - 1] = update(values[values.length - 1]);
  return { week, values };
}
