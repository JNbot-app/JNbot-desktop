export type CliLayout = 'compact' | 'standard' | 'wide';

export function layoutForWidth(width: number): CliLayout {
  if (width < 60) return 'compact';
  if (width < 100) return 'standard';
  return 'wide';
}
