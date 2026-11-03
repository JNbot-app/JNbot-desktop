import { Form, Select, type SelectProps } from 'antd';
import { FC, memo } from 'react';
import {
  ScriptSettingProps,
  ScriptSettingsProps_GamemodeSelect,
} from '../ScriptSettingsProps.d';
import {
  useSettingsStore,
  selectActiveServerGamemodes,
} from '../../../../redux/settings';
import MultiSelectOption from './MultiSelectOption';

const getGamemodeOptions = (gamemodes: string[]) =>
  gamemodes.map((gamemode) => ({ label: gamemode, value: gamemode }));

export const GamemodeSelect = memo(
  ({
    gamemodes: propGamemodes,
    style,
    ...props
  }: Omit<SelectProps<string>, 'options' | 'mode'> & {
    gamemodes?: string[];
  }) => {
    const activeGamemodes = useSettingsStore(selectActiveServerGamemodes);
    const gamemodes = propGamemodes ?? activeGamemodes;

    return (
      <Select
        {...props}
        options={getGamemodeOptions(gamemodes)}
        style={{ width: '100%', ...style }}
      />
    );
  },
);

const GamemodeSelectOption: FC<{
  option: ScriptSettingsProps_GamemodeSelect;
  onChange?: (
    e: number | string | (string | string[] | number[])[],
    option: ScriptSettingProps,
  ) => void;
  value: string | number | (string | string[] | number[])[];
}> = ({ option, ...args }) => {
  const activeGamemodes = useSettingsStore(selectActiveServerGamemodes);
  const gamemodes = option.gamemodes || activeGamemodes;

  if (option.multiple) {
    return (
      <MultiSelectOption
        {...args}
        value={Array.isArray(args.value) ? args.value : []}
        option={{
          ...option,
          options: gamemodes,
          type: 'multiSelect',
          defaultValue: Array.isArray(option.defaultValue)
            ? option.defaultValue
            : option.defaultValue
              ? [option.defaultValue]
              : undefined,
        }}
      />
    );
  }

  const value = Array.isArray(args.value)
    ? String(args.value[0] ?? '')
    : String(args.value ?? '');

  return (
    <Form.Item label={option.label} name={option.id} style={{ width: '100%' }}>
      <GamemodeSelect
        id={option.id}
        value={value}
        gamemodes={gamemodes}
        className={option.className}
        onChange={(next) => args.onChange?.(next, option)}
      />
    </Form.Item>
  );
};

export default GamemodeSelectOption;
