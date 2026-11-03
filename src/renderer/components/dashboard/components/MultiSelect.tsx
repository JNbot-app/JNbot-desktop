import React from 'react';
import { Select, Checkbox, Typography } from 'antd';

const { Option } = Select;

interface MultiSelectProps {
  scriptName: string;
  label: string;
  value: string[];
  options: string[];
  placeholder: string;
  saveSetting: (value: string[]) => void;
  helperText?: string;
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  scriptName,
  value,
  options,
  placeholder,
  saveSetting,
  helperText,
}) => {
  if (!scriptName) return null;

  return (
    <div style={{ position: 'relative', maxWidth: '400px', minWidth: '200px' }}>
      <Select
        mode="multiple"
        value={value}
        onChange={(newVal) => saveSetting(newVal as string[])}
        style={{ width: '100%' }}
        placeholder={placeholder}
        maxTagCount={3}
        popupRender={menu => (
          <div style={{ maxHeight: '15rem', overflowY: 'auto' }}>
            {menu}
          </div>
        )}
        optionLabelProp="label"
      >
        {options.map(opt => (
          <Option key={opt} value={opt} label={opt}>
            <Checkbox checked={value.includes(opt)} style={{ marginRight: 8 }} />
            {opt}
          </Option>
        ))}
      </Select>
      {helperText && (
        <Typography.Text style={{ display: 'block', marginTop: '8px' }}>
          {helperText}
        </Typography.Text>
      )}
    </div>
  );
};

export default MultiSelect;
