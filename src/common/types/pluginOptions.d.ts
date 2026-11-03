export type AltRangeValue = [string | null, string | null];

export type ActiveBotFilter = 'all' | 'bots' | 'minecraft';

export type PluginOptionType =
  | 'select'
  | 'multiSelect'
  | 'slider'
  | 'input'
  | 'gamemodeSelect'
  | 'altSelect'
  | 'altsSelect'
  | 'tagsSelect'
  | 'altRange'
  | 'switch'
  | 'list'
  | 'coordinate'
  | 'keybind'
  | 'activeBotSelect';

export interface PluginOptionBase {
  id: string;
  label: string;
  type: PluginOptionType;
  tooltip?: string;
  required?: boolean;
  valueByFieldId?: string;
  className?: string;
}

export type PluginOptionChoice = { label: string; value: string | number };

export interface PluginListField {
  key: string;
  label: string;
  type: 'input' | 'switch' | 'slider' | 'select' | 'altSelect';
  inputType?: 'text' | 'number' | 'password';
  placeholder?: string;
  options?: PluginOptionChoice[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: unknown;
}

export interface PluginOptionInput extends PluginOptionBase {
  type: 'input';
  inputType?: 'text' | 'number' | 'password';
  placeholder?: string;
  defaultValue?: number | string;
}

export interface PluginOptionSwitch extends PluginOptionBase {
  type: 'switch';
  defaultValue?: boolean;
  labelChecked?: string;
  labelUnchecked?: string;
}

export interface PluginOptionSelect extends PluginOptionBase {
  type: 'select';
  options: PluginOptionChoice[];
  defaultValue?: string | number;
  clearable?: boolean;
  freeSolo?: boolean;
}

export interface PluginOptionMultiSelect extends PluginOptionBase {
  type: 'multiSelect';
  options: string[];
  defaultValue?: string[];
  freeSolo?: boolean;
}

export interface PluginOptionSlider extends PluginOptionBase {
  type: 'slider';
  min: number;
  max: number;
  step: number;
  marks?: Record<number, string>;
  defaultValue?: number;
}

export interface PluginOptionGamemodeSelect extends PluginOptionBase {
  type: 'gamemodeSelect';
  gamemodes?: string[];
  multiple?: boolean;
  defaultValue?: string | string[];
}

export interface PluginOptionAltSelect extends PluginOptionBase {
  type: 'altSelect';
  defaultValue?: string;
  clearable?: boolean;
  freeSolo?: boolean;
}

export interface PluginOptionAltsSelect extends PluginOptionBase {
  type: 'altsSelect';
  defaultValue?: string[];
}

export interface PluginOptionTagsSelect extends PluginOptionBase {
  type: 'tagsSelect';
  defaultValue?: string[];
}

export interface PluginOptionAltRange extends PluginOptionBase {
  type: 'altRange';
  defaultValue?: AltRangeValue;
}

export interface PluginOptionList extends PluginOptionBase {
  type: 'list';
  fields: PluginListField[];
  defaultValue?: Record<string, any>[];
  minItems?: number;
  maxItems?: number;
  addLabel?: string;
}

export interface PluginOptionCoordinate extends PluginOptionBase {
  type: 'coordinate';
  defaultValue?: {
    x?: number;
    y?: number;
    z?: number;
    dimension?: 'overworld' | 'nether' | 'end';
  };
  withDimension?: boolean;
}

export interface PluginOptionKeybind extends PluginOptionBase {
  type: 'keybind';
  defaultValue?: string;
  simple?: boolean;
}

export interface PluginOptionActiveBotSelect extends PluginOptionBase {
  type: 'activeBotSelect';
  botFilter?: ActiveBotFilter;
  filter?: ActiveBotFilter;
  multiple?: boolean;
  clearable?: boolean;
  freeSolo?: boolean;
  placeholder?: string;
  defaultValue?: string[];
}

export type PluginOption =
  | PluginOptionInput
  | PluginOptionSwitch
  | PluginOptionSelect
  | PluginOptionMultiSelect
  | PluginOptionSlider
  | PluginOptionGamemodeSelect
  | PluginOptionAltSelect
  | PluginOptionAltsSelect
  | PluginOptionTagsSelect
  | PluginOptionAltRange
  | PluginOptionList
  | PluginOptionCoordinate
  | PluginOptionKeybind
  | PluginOptionActiveBotSelect;

export interface PluginOptionSection {
  name: string;
  options: PluginOption[];
  collapsed?: boolean;
  className?: string;
}

export type PluginOptionSchema = PluginOptionSection[];
