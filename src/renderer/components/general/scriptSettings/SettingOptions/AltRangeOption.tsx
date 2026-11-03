import { FC } from 'react';
import { Form, Select, Typography, theme } from 'antd';
import { CaretRightFilled } from '@ant-design/icons';
import { useSettingsStore, selectAlts } from '../../../../redux/settings';
import type {
  AltRangeValue,
  ScriptSettingProps,
  ScriptSettingsProps_AltRange,
} from '../ScriptSettingsProps.d';

const AltRangeOption: FC<{
  option: ScriptSettingsProps_AltRange;
  onChange?: (
    e:
      | AltRangeValue
      | number
      | string
      | (string | string[] | number[])[]
      | null,
    option: ScriptSettingProps,
  ) => void;
  value: AltRangeValue | undefined;
}> = ({ option, onChange, value }) => {
  const {
    token: { colorBorderSecondary, colorBgElevated, colorPrimary },
  } = theme.useToken();

  const alts = useSettingsStore(selectAlts) as { username: string }[];
  const startWith = value?.[0] ?? null;
  const endsWith = value?.[1] ?? null;

  const emit = (nextValue: AltRangeValue) => {
    onChange?.(nextValue as any, option as ScriptSettingProps);
  };

  const startWithIndex = alts.findIndex((a) => a.username === startWith);
  const endsWithIndex = alts.findIndex((a) => a.username === endsWith);

  const optionsStartWith = alts
    .slice(0, endsWithIndex === -1 ? undefined : endsWithIndex + 1)
    .map((a) => ({ value: a.username, label: a.username }));

  const optionsEndsWith = alts
    .slice(startWithIndex === -1 ? undefined : startWithIndex)
    .map((a) => ({ value: a.username, label: a.username }));

  return (
    <Form.Item
      label={option.label}
      name={option.id}
      tooltip={option.tooltip}
      style={{ maxWidth: '560px', width: '100%', minWidth: '320px' }}
    >
      <div
        style={{
          padding: 12,
          border: `1px solid ${colorBorderSecondary}`,
          borderRadius: 8,
          background: colorBgElevated,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
            >
              Start with
            </Typography.Text>
            <Select
              value={startWith ?? undefined}
              onChange={(v) => emit([v ?? null, endsWith])}
              options={optionsStartWith}
              placeholder="First alt (default)"
              style={{ width: '100%' }}
              allowClear
              showSearch={{
                optionFilterProp: 'label',
              }}
            />
          </div>

          <CaretRightFilled
            style={{
              color: colorPrimary,
              fontSize: 18,
              padding: '0 0 8px 0',
            }}
          />

          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
            >
              End with
            </Typography.Text>
            <Select
              value={endsWith ?? undefined}
              onChange={(v) => emit([startWith, v ?? null])}
              options={optionsEndsWith}
              placeholder="Last alt (default)"
              style={{ width: '100%' }}
              allowClear
              showSearch={{
                optionFilterProp: 'label',
              }}
            />
          </div>
        </div>
      </div>
    </Form.Item>
  );
};

export default AltRangeOption;
