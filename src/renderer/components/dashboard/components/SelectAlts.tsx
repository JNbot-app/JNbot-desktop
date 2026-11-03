import React, { useState, useEffect } from 'react';
import { Select, Input, Form, Typography } from 'antd';
import {
  useSettingsStore,
  selectSettings,
  updateScriptSettings,
  selectAlts,
} from '../../../redux/settings';

interface SelectAltsProps {
  scriptName: string;
  name: string;
  freeSolo?: boolean;
  helperText?: string;
  label?: string;
  disableClearable?: boolean;
  error?: string;
}

const SelectAlts: React.FC<SelectAltsProps> = ({
  scriptName,
  name,
  freeSolo = false,
  helperText,
  label,
  disableClearable = false,
  error,
}) => {
  if (!scriptName || !name) return null;

  const settings = useSettingsStore(selectSettings);
  const _alts = useSettingsStore(selectAlts);
  const [alts, setAlts] = useState<string[]>([]);

  useEffect(() => {
    setAlts([..._alts.map((alt: any) => alt.username), '']);
  }, [_alts]);

  const handleChange = (value: string) => {
    updateScriptSettings({
      optionId: name,
      value: value ?? '',
      scriptName: scriptName,
    });
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (
      freeSolo &&
      e.target.value.length > 2 &&
      e.target.value !== settings.scripts?.[scriptName]?.[name]
    ) {
      updateScriptSettings({
        optionId: name,
        value: e.target.value.trim(),
        scriptName: scriptName,
      });
    }
  };

  return (
    <Form.Item
      label={label}
      help={helperText || error}
      validateStatus={error ? 'error' : ''}
      style={{ width: 300 }}
    >
      <Select
        value={settings.scripts?.[scriptName]?.[name] ?? ''}
        onChange={handleChange}
        onBlur={handleBlur}
        options={alts.map((alt) => ({ value: alt }))}
        allowClear={!disableClearable}
        showSearch
        filterOption={(input, option) =>
          (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
        }
        popupRender={(menu) => (
          <div>
            {menu}
            {freeSolo && (
              <Input
                style={{ width: '100%', padding: '8px' }}
                placeholder="Add new alt"
                onPressEnter={(e) =>
                  handleChange((e.target as HTMLInputElement).value)
                }
              />
            )}
          </div>
        )}
      />
    </Form.Item>
  );
};

export default SelectAlts;
