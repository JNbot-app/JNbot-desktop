import { FC } from 'react';
import { Form, Input } from 'antd';
import {
  ScriptSettingProps,
  ScriptSettingsProps_Input,
} from '../ScriptSettingsProps.d';

const InputOption: FC<{
  option: ScriptSettingsProps_Input;
  onChange?: (
    e: number | string | (string | string[] | number[])[],
    option: ScriptSettingProps,
  ) => void;
  value: string | number;
}> = ({ option, onChange, value }) => {
  const InputComponent =
    option.inputType === 'password' ? Input.Password : Input;
  return (
    <Form.Item
      label={option.label}
      name={option.id}
      tooltip={option.tooltip}
      style={{ width: '100%' }}
    >
      <InputComponent
        type={option.inputType ?? 'text'}
        onChange={(e) => onChange?.(e.target.value, option)}
        id={option.id}
        value={value}
        className={option.className}
        placeholder={option.placeholder}
      />
    </Form.Item>
  );
};

export default InputOption;
