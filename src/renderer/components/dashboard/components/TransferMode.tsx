import React from 'react';
import {
  useSettingsStore,
  selectSettings,
  updateScriptSettings,
} from '../../../redux/settings';
import { Select, Form, Typography } from 'antd';

const { Option } = Select;

interface TransferModeProps {
  scriptName: string;
  name: string;
}

const TransferMode: React.FC<TransferModeProps> = ({ scriptName, name }) => {
  const settings = useSettingsStore(selectSettings);

  if (!scriptName || !name) return null;

  const handleChange = (value: number) => {
    updateScriptSettings({
      optionId: name,
      value: value ?? 0,
      scriptName,
    });
  };

  return (
    <Form.Item label={<Typography.Text>Item transfer</Typography.Text>}>
      <Select
        value={settings.scripts?.[scriptName]?.[name] ?? 0}
        onChange={handleChange}
        style={{ width: 300 }}
      >
        <Option value={0}>Keep items</Option>
        <Option value={1}>Trade items</Option>
        <Option value={2}>Gift items</Option>
      </Select>
    </Form.Item>
  );
};

export default TransferMode;
