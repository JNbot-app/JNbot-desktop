import React, { useEffect, useState } from 'react';
import {
  Input,
  InputNumber,
  Switch,
  Radio,
  Select,
  Typography,
  Form,
  Cascader,
} from 'antd';
import SelectFolder from '../other/SelectFolder';

const { Item: FormItem } = Form;

/**
 * Text setting input. Commits on blur (so typing isn't persisted keystroke by
 * keystroke), but stays in sync with the external value: a bare uncontrolled
 * `<Input defaultValue>` ignores prop changes after mount, which left the field
 * stale when switching profiles swapped in that profile's saved value. Mirror
 * the value into local draft state and re-sync whenever it changes externally.
 */
const SettingInput: React.FC<{
  value: any;
  placeholder?: string;
  inputProps?: Record<string, any>;
  onCommit: (value: string) => void;
}> = ({ value, placeholder, inputProps, onCommit }) => {
  const [draft, setDraft] = useState<string>(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);

  return (
    <Input
      {...(inputProps ?? {})}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
};

const SettingListItem: React.FC<{
  setting: any;
  value: any;
  changeSetting: (arg: { key: string; value: any }) => void;
  /** Name of the active profile — shown on the per-profile badge. */
  profileLabel?: string;
}> = ({ setting, value, changeSetting }) => {
  value = value ?? setting.default;

  const settingName = (
    <div className="settings-list-item-copy">
      <Typography.Text strong>{setting.name}</Typography.Text>
      <Typography.Paragraph type="secondary">
        {setting.description}
      </Typography.Paragraph>
    </div>
  );

  const row = (
    control: React.ReactNode,
    options?: { alignRight?: boolean; stacked?: boolean; wide?: boolean },
  ) => (
    <div
      className={`settings-list-item${
        options?.stacked ? ' settings-list-item--stacked' : ''
      }`}
    >
      {settingName}
      <div
        className={`settings-list-item-control${
          options?.wide ? ' settings-list-item-control--wide' : ''
        }${options?.alignRight ? ' settings-list-item-control--right' : ''}`}
      >
        {control}
      </div>
    </div>
  );

  switch (setting.type) {
    case 'input':
      return row(
        <FormItem>
          <SettingInput
            value={value}
            placeholder={setting.label}
            inputProps={setting.props}
            onCommit={(v) => changeSetting({ key: setting.key, value: v })}
          />
        </FormItem>,
      );

    case 'number':
      return row(
        <FormItem>
          <InputNumber
            style={{ width: '100%' }}
            min={setting.min ?? 0}
            step={setting.step ?? 1}
            value={value}
            onChange={(val) =>
              changeSetting({ key: setting.key, value: val ?? 0 })
            }
          />
        </FormItem>,
      );

    case 'select':
      return row(
        <FormItem>
          <Select
            style={{ width: '100%' }}
            defaultValue={setting.default}
            value={value ?? setting.default}
            onChange={(val) => changeSetting({ key: setting.key, value: val })}
            options={setting.options}
          />
        </FormItem>,
      );

    case 'radio btn':
      return row(
        <Radio.Group
          value={value}
          onChange={(e) =>
            changeSetting({ value: e.target.value, key: setting.key })
          }
        >
          {setting.options.map((option: string) => (
            <Radio key={option} value={option}>
              {option}
            </Radio>
          ))}
        </Radio.Group>,
      );

    case 'switch':
      return row(
        <Switch
          onChange={(checked) =>
            changeSetting({ value: checked, key: setting.key })
          }
          checked={value ?? setting.default}
        />,
        { alignRight: true },
      );

    case 'input_file':
      return row(
        <SelectFolder
          defaultValue={value ?? setting.default}
          id={setting.key}
          label={setting.label}
          value={value ?? setting.default}
          onChange={(val) => changeSetting({ key: setting.key, value: val })}
        />,
      );
    case 'cascade':
      return row(
        <FormItem>
          <Cascader
            style={{ width: '100%' }}
            defaultValue={setting.default}
            value={value ?? setting.default}
            popupMatchSelectWidth
            onChange={(_: any, options) => {
              changeSetting({
                key: setting.key,
                value: options.at(-1)?.value ?? setting.default,
              });
            }}
            options={setting.options}
          />
        </FormItem>,
      );
    case 'custom': {
      const inline = setting.layout === 'inline';
      return row(
        <setting.Render
          changeSetting={changeSetting}
          value={value}
          setting={setting}
        />,
        { alignRight: inline, stacked: !inline, wide: !inline },
      );
    }

    default:
      return null;
  }
};
export default SettingListItem;
