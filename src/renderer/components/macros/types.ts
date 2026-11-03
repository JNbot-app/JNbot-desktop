export type { MacroInfo } from '../../../main/src/types';

export type PluginDisplayMode = 'grid' | 'list';
export type SortOrder = 'name' | 'date';

export interface ScriptThemeType {
  primaryColor: string;
  secondaryColor: string;
  gradientStart?: string;
  gradientEnd?: string;
  accentColor?: string;
  tagColor?: string;
}
