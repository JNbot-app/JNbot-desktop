import { FC } from 'react';
import { Form, InputNumber, Select, Space } from 'antd';
import type {
  CoordinateValue,
  ScriptSettingProps,
  ScriptSettingsProps_Coordinate,
} from '../ScriptSettingsProps.d';

const DIMENSIONS = [
  { value: 'overworld', label: 'Overworld' },
  { value: 'nether', label: 'Nether' },
  { value: 'end', label: 'End' },
];

const CoordinateOption: FC<{
  option: ScriptSettingsProps_Coordinate;
  onChange?: (e: any, option: ScriptSettingProps) => void;
  value: (CoordinateValue & { dim?: string }) | undefined;
}> = ({ option, onChange, value }) => {
  const v = value || option.defaultValue || {};

  const update = (patch: Partial<CoordinateValue & { dim?: string }>) => {
    onChange?.({ ...v, ...patch } as any, option);
  };

  return (
    <Form.Item label={option.label} tooltip={option.tooltip}>
      <Space.Compact block>
        <InputNumber
          addonBefore="X"
          value={v.x ?? null}
          onChange={(n) => update({ x: n ?? undefined })}
          style={{ flex: 1 }}
        />
        <InputNumber
          addonBefore="Y"
          value={v.y ?? null}
          onChange={(n) => update({ y: n ?? undefined })}
          style={{ flex: 1 }}
        />
        <InputNumber
          addonBefore="Z"
          value={v.z ?? null}
          onChange={(n) => update({ z: n ?? undefined })}
          style={{ flex: 1 }}
        />
        {option.withDimension && (
          <Select
            value={(v as any).dim}
            onChange={(dim) => update({ dim })}
            options={DIMENSIONS}
            placeholder="Dimension"
            style={{ minWidth: 130 }}
            allowClear
          />
        )}
      </Space.Compact>
    </Form.Item>
  );
};

export default CoordinateOption;
