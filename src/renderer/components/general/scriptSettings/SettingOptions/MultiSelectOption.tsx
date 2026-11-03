import { FC, memo } from 'react';
import { Select, Form } from 'antd';
import { ScriptSettingProps, ScriptSettingsProps_MultiSelect } from '../ScriptSettingsProps.d';

const MultiSelectOption: FC<{
  option: ScriptSettingsProps_MultiSelect;
  onChange?: (e: number | string | (string | string[] | number[])[], option: ScriptSettingProps) => void;
  value: (string | string[] | number[])[];
}> = ({ option, onChange, value }) => {
  return (
    <Form.Item
      label={option.label}
      name={option.id}
      tooltip={option.tooltip}
      style={{ maxWidth: '400px', width: '100%', minWidth: '200px' }}
    >
      <Select
        mode={option.freeSolo ? 'tags' : 'multiple'}
        value={value}
        onChange={(newVal) => onChange?.(newVal, option)}
        style={{ width: '100%' }}
        placeholder={option.label}
        className={option.className}
        optionLabelProp="label"
        options={((option?.options ?? []) as string[]).map((o) => ({
          value: o,
          label: o,
        }))}
      />
    </Form.Item>
  );
};

export default memo(MultiSelectOption);
