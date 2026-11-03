import type { ConsoleLogValue } from './mobileClientContract';

/** Text form of an already bounded log snapshot. */
export function logText(value: ConsoleLogValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
