import { FC } from 'react';
import {
  AltRangeValue,
  OptionTypes,
  ScriptSettingProps,
} from '../ScriptSettingsProps.d';
import AltSelectOption from './AltSelectOption';
import AltsSelectOption from './AltsSelectOption';
import GamemodeSelectOption from './GamemodeSelectOption';
import InputOption from './InputOption';
import MultiSelectOption from './MultiSelectOption';
import SelectOption from './SelectOption';
import SliderOption from './SliderOption';
import SwitchOption from './SwitchOption';
import TagsSelectOption from './TagsSelectOption';
import AltRangeOption from './AltRangeOption';
import ListOption from './ListOption';
import CoordinateOption from './CoordinateOption';
import KeybindOption from './KeybindOption';
import ActiveBotSelectOption from './ActiveBotSelectOption';
import ScriptSelectOption from './ScriptSelectOption';

const options: Record<OptionTypes, FC<any>> = {
  select: SelectOption,
  slider: SliderOption,
  altSelect: AltSelectOption,
  altsSelect: AltsSelectOption,
  tagsSelect: TagsSelectOption,
  altRange: AltRangeOption,
  gamemodeSelect: GamemodeSelectOption,
  input: InputOption,
  multiSelect: MultiSelectOption,
  switch: SwitchOption,
  list: ListOption,
  coordinate: CoordinateOption,
  keybind: KeybindOption,
  activeBotSelect: ActiveBotSelectOption,
  scriptSelect: ScriptSelectOption,
};

const Option: FC<{
  option: ScriptSettingProps;
  onChange: (
    e:
      | boolean
      | number
      | string
      | AltRangeValue
      | (string | string[] | number[])[],
    option: ScriptSettingProps,
  ) => void;
  value: unknown;
}> = ({ option, ...args }) => {
  const Comp = options[option.type] as any;
  if (!Comp) return null;
  return (<Comp {...args} option={option} />) as JSX.Element;
};

export default Option;
