import { Select as AntSelect, Form, AutoComplete } from 'antd';
import { FC, memo } from 'react';
import {
  ScriptSettingProps,
  ScriptSettingsProps_Select,
} from '../ScriptSettingsProps.d';

const SelectOption: FC<{
  option: ScriptSettingsProps_Select;
  onChange?: (
    e: NonNullable<string | number>,
    option: ScriptSettingProps,
  ) => void;
  value: string | number;
}> = ({ option, onChange, value }) => {
  if (option.freeSolo || option.clearable) {
    return (
      <Form.Item
        label={option.label}
        name={option.id}
        style={{ width: '100%' }}
      >
        <AutoComplete
          onChange={(val) => !option.freeSolo && onChange?.(val, option)}
          onBlur={(e) => {
            if (option.freeSolo) {
              onChange?.((e.target as any).value, option);
            }
          }}
          allowClear={option.clearable}
          value={value}
          options={option.options.map((opt) => ({
            value: opt.value,
            label: opt.label,
          }))}
          style={{ width: '100%' }}
          className={option.className}
        />
      </Form.Item>
    );
  } else {
    return (
      <Form.Item
        label={option.label}
        name={option.id}
        style={{ width: '100%' }}
      >
        <AntSelect
          id={option.id}
          value={value}
          onChange={(val) => onChange?.(val, option)}
          style={{ width: '100%' }}
          options={option.options}
          className={option.className}
        />
      </Form.Item>
    );
  }
};

export default memo(SelectOption);
