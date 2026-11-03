import { FC } from 'react';
import { useSettingsStore, selectAlts } from '../../../../redux/settings';
import {
  ScriptSettingProps,
  ScriptSettingsProps_AltSelect,
} from '../ScriptSettingsProps.d';
import SelectOption from './SelectOption';

const AltSelectOption: FC<{
  option: ScriptSettingsProps_AltSelect;
  onChange?: (
    e: number | string | (string | string[] | number[])[],
    option: ScriptSettingProps,
  ) => void;
  value: string | number;
}> = ({ option, ...args }) => {
  const alts = useSettingsStore(selectAlts) as { username: string }[];
  return (
    <SelectOption
      {...args}
      option={{
        ...option,
        options: alts.map((e) => ({ label: e.username, value: e.username })),
        type: 'select',
      }}
    />
  );
};

export default AltSelectOption;
