import { FC, KeyboardEvent, useState } from 'react';
import { Button, Form, Input, Space } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type {
  ScriptSettingProps,
  ScriptSettingsProps_Keybind,
} from '../ScriptSettingsProps.d';

function normalizeKey(e: KeyboardEvent<HTMLInputElement>): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.shiftKey) mods.push('Shift');
  if (e.altKey) mods.push('Alt');
  if (e.metaKey) mods.push('Meta');
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  return [...mods, key].join('+');
}

const KeybindOption: FC<{
  option: ScriptSettingsProps_Keybind;
  onChange?: (e: any, option: ScriptSettingProps) => void;
  value: string | undefined;
}> = ({ option, onChange, value }) => {
  const [capturing, setCapturing] = useState(false);
  const current = value ?? option.defaultValue ?? '';

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const combo = normalizeKey(e);
    if (!combo) return;
    if (option.simple && combo.includes('+')) return;
    onChange?.(combo as any, option);
    setCapturing(false);
    e.currentTarget.blur();
  };

  return (
    <Form.Item name={option.id} label={option.label} tooltip={option.tooltip}>
      <Space.Compact block>
        <Input
          readOnly
          value={capturing ? 'Press a key…' : current}
          placeholder="Click to capture a key combo"
          onFocus={() => setCapturing(true)}
          onBlur={() => setCapturing(false)}
          onKeyDown={handleKey}
        />
        {current && (
          <Button
            icon={<CloseOutlined />}
            onClick={() => onChange?.('' as any, option)}
            title="Clear"
          />
        )}
      </Space.Compact>
    </Form.Item>
  );
};

export default KeybindOption;
