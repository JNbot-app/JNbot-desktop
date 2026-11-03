import { Form, Select } from 'antd';
import { FC } from 'react';
import { useSettingsStore, selectAlts } from '../../../redux/settings';
import { Rule } from 'antd/es/form';

const SelectAlt: FC<{
  name: string;
  freeSolo?: boolean;
  rules?: Rule[];
}> = ({ name, rules }) => {
  const alts = useSettingsStore(selectAlts);
  return (
    <Form.Item label="Username" name={name} rules={rules}>
      <Select
        placeholder="Username"
        options={alts.map((alt) => ({
          label: alt.username,
          value: alt.username,
        }))}
        allowClear
        showSearch
      />
    </Form.Item>
  );
};

export default SelectAlt;
