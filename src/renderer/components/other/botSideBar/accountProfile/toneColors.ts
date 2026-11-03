import type { ProfileUiTone } from '../../../../../common/profileUiSchema';

/**
 * AntD-compatible color name for a given semantic tone. Used by `Tag`,
 * `Statistic`, and accent borders so the section components never reach
 * for hard-coded hex values.
 */
export const TONE_TO_ANTD: Record<ProfileUiTone, string> = {
  amber: 'gold',
  emerald: 'green',
  rose: 'magenta',
  indigo: 'geekblue',
  sky: 'blue',
  purple: 'purple',
  slate: 'default',
  red: 'red',
  cyan: 'cyan',
};

/** Hex used for accent borders / icon backgrounds. */
export const TONE_TO_HEX: Record<ProfileUiTone, string> = {
  amber: '#FDAC41',
  emerald: '#52C41A',
  rose: '#EB2F96',
  indigo: '#7C5CFF',
  sky: '#1677FF',
  purple: '#722ED1',
  slate: '#8C8C8C',
  red: '#FF4D4F',
  cyan: '#13C2C2',
};
