import type {
  AltRangeValue,
  PluginListField,
  PluginOptionSchema,
  PluginOptionType,
} from '../../../../common/pluginOptions';

export type { AltRangeValue } from '../../../../common/pluginOptions';

export type OptionTypes = PluginOptionType;

export interface ScriptSettingProps_main {
  id: string;
  label: string;
  type: OptionTypes;
  tooltip?: string;
  required?: boolean; // marks the option as required; the script handles the actual validation
  validate?: (
    value: string | number | boolean | string[] | AltRangeValue,
    settings?: any,
  ) => boolean | { valid: boolean; message: string };
  valueByFieldId?: string; // if set, the value is saved per selected string-valued field
  visible?: (settings: any) => boolean;
  className?: string;
}

export interface ScriptSettingsProps_Select extends ScriptSettingProps_main {
  type: 'select';
  options: {
    label: string;
    value: string | number;
  }[];
  defaultValue?: string | number;
  clearable?: boolean;
  freeSolo?: boolean;
}

export interface ScriptSettingsProps_MultiSelect
  extends ScriptSettingProps_main {
  type: 'multiSelect';
  options: string[] | ((settings: any) => string[]);
  defaultValue?: string[];
  freeSolo?: boolean;
}

export interface ScriptSettingsProps_Slider extends ScriptSettingProps_main {
  type: 'slider';
  min: number;
  max: number;
  step: number;
  marks?: Record<number, string>;
  defaultValue?: number;
}

export interface ScriptSettingsProps_Input extends ScriptSettingProps_main {
  type: 'input';
  inputType?: 'text' | 'number' | 'password';
  defaultValue?: number | string;
  placeholder?: string;
}

/**
 * Gamemode picker. `gamemodes` is optional — when not provided the renderer
 * falls back to the current server's gamemodes (from `window.__JNdata`).
 * Plugin authors should leave it unset; the field is kept only so other call
 * sites that need a hardcoded list can supply one.
 */
export interface ScriptSettingsProps_GamemodeSelect
  extends ScriptSettingProps_main {
  type: 'gamemodeSelect';
  gamemodes?: string[];
  /** When true, allow picking multiple gamemodes; the value becomes a string[]. */
  multiple?: boolean;
  defaultValue?: string | string[];
}

export interface ScriptSettingsProps_AltSelect extends ScriptSettingProps_main {
  type: 'altSelect';
  defaultValue?: string;
  clearable?: boolean;
  freeSolo?: boolean;
}

export interface ScriptSettingsProps_AltsSelect
  extends ScriptSettingProps_main {
  type: 'altsSelect';
  defaultValue?: string[];
}

/**
 * Pick one or more alt tags. The stored value is an array of tag IDs;
 * scripts can resolve them to alts via `settings.altTags[server]`.
 */
export interface ScriptSettingsProps_TagsSelect
  extends ScriptSettingProps_main {
  type: 'tagsSelect';
  defaultValue?: string[];
}

/**
 * A single UI control for "process a contiguous slice of the alt list".
 * Persists as one tuple under `option.id`: `[startWith, endsWith]`.
 * Both endpoints are optional: leaving start unset means "from the first
 * alt", leaving end unset means "until the last alt".
 */
export interface ScriptSettingsProps_AltRange extends ScriptSettingProps_main {
  type: 'altRange';
  defaultValue?: AltRangeValue;
}

export interface ScriptSettingsProps_Switch extends ScriptSettingProps_main {
  type: 'switch';
  defaultValue?: boolean;
  labelChecked?: string;
  labelUnchecked?: string;
}

/**
 * Sub-field types usable inside a `list` option. A curated subset of the
 * top-level types; nesting (list of lists) is intentionally disallowed.
 */
export type ListFieldType =
  | 'input'
  | 'switch'
  | 'slider'
  | 'select'
  | 'altSelect';

export interface ListField extends PluginListField {
  /** Stored key on each row object — must be unique within the list. */
  type: ListFieldType;
}

/**
 * Generic row-list editor: each row is an object keyed by `fields[i].key`.
 * Replaces the older `books` type — the book sorter now declares its own
 * schema with this option instead.
 */
export interface ScriptSettingsProps_List extends ScriptSettingProps_main {
  type: 'list';
  fields: ListField[];
  defaultValue?: Record<string, any>[];
  minItems?: number;
  maxItems?: number;
  addLabel?: string;
}

export interface CoordinateValue {
  x?: number;
  y?: number;
  z?: number;
}

/** Minecraft-style 3D coordinate (x / y / z). All components optional. */
export interface ScriptSettingsProps_Coordinate
  extends ScriptSettingProps_main {
  type: 'coordinate';
  defaultValue?: CoordinateValue;
  /** When true, asks the user to also supply a dimension (overworld/nether/end). */
  withDimension?: boolean;
}

/**
 * Capture a single key combination (e.g. "Ctrl+Shift+K"). The stored value
 * is a normalised string with modifiers in canonical order.
 */
export interface ScriptSettingsProps_Keybind extends ScriptSettingProps_main {
  type: 'keybind';
  defaultValue?: string;
  /** When true, only allows letter/number keys without modifiers. */
  simple?: boolean;
}

export type ActiveBotFilter = 'all' | 'bots' | 'minecraft';

/**
 * Select one or multiple active bots or Minecraft clients.
 */
export interface ScriptSettingsProps_ActiveBotSelect
  extends ScriptSettingProps_main {
  type: 'activeBotSelect';
  /** Filter candidates: 'all' (default), 'bots' (JNbot worker bots only), or 'minecraft' (MC clients only). */
  botFilter?: ActiveBotFilter;
  filter?: ActiveBotFilter;
  /** When true, allow picking multiple bots/clients. Stored value is always string[]. */
  multiple?: boolean;
  defaultValue?: string[];
  clearable?: boolean;
  freeSolo?: boolean;
  placeholder?: string;
}

export type ScriptSettingProps =
  | ScriptSettingsProps_Select
  | ScriptSettingsProps_MultiSelect
  | ScriptSettingsProps_Slider
  | ScriptSettingsProps_Input
  | ScriptSettingsProps_GamemodeSelect
  | ScriptSettingsProps_AltSelect
  | ScriptSettingsProps_AltsSelect
  | ScriptSettingsProps_TagsSelect
  | ScriptSettingsProps_AltRange
  | ScriptSettingsProps_Switch
  | ScriptSettingsProps_List
  | ScriptSettingsProps_Coordinate
  | ScriptSettingsProps_Keybind
  | ScriptSettingsProps_ActiveBotSelect;

export interface ScriptSettingsSection extends Omit<PluginOptionSchema[number], 'options'> {
  options: ScriptSettingProps[];
}

export interface ScriptSettingsProps {
  name: string;
  scriptName: string;
  description?: string;
  scheme: ScriptSettingsSection[];
  args?: Record<string, any>;
  devMode?: boolean; // if true, the script will be run in dev mode, which means it will not be saved to the server and will not be visible to other users

  classNames?: {
    options?: string;
  };
}
