import React, { FC } from 'react';
import { Tooltip, Switch, Form } from 'antd';
import {
  ScriptSettingProps,
  ScriptSettingsProps_Switch,
} from '../ScriptSettingsProps.d';

const SwitchOption: FC<{
  option: ScriptSettingsProps_Switch;
  onChange?: (e: boolean, option: ScriptSettingProps) => void;
  value: boolean;
}> = ({ option, onChange, value }) => {
  return (
    <Form.Item label={option.label} name={option.id} valuePropName='checked' layout="horizontal" >
        <Tooltip title={option.tooltip ?? ''} placement="top">
        <Switch
          checked={value}
          className={option.className}
          checkedChildren={option.labelChecked}
          unCheckedChildren={option.labelUnchecked}
          onChange={(checked) => onChange?.(checked, option)}
          id={option.id}
        />
    </Tooltip>
      </Form.Item>
  );
};

export default SwitchOption;
