import { FC } from 'react';
import { useSettingsStore, selectAlts } from '../../../../redux/settings';
import {
  ScriptSettingProps,
  ScriptSettingsProps_AltsSelect,
} from '../ScriptSettingsProps.d';
import MultiSelectOption from './MultiSelectOption';

const AltsSelectOption: FC<{
  option: ScriptSettingsProps_AltsSelect;
  onChange?: (
    e: number | string | (string | string[] | number[])[],
    option: ScriptSettingProps,
  ) => void;
  value: (string | string[] | number[])[];
}> = ({ option, ...args }) => {
  const alts = useSettingsStore(selectAlts) as { username: string }[];
  return (
    <MultiSelectOption
      {...args}
      option={{
        ...option,
        options: alts.map((e) => e.username),
        type: 'multiSelect',
      }}
    />
  );
};

export default AltsSelectOption;
