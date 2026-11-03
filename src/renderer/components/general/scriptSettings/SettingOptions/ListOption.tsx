import { FC } from 'react';
import { Button, Form, Input, InputNumber, Select, Switch, Table } from 'antd';
import type { TableProps } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type {
  ListField,
  ScriptSettingProps,
  ScriptSettingsProps_List,
} from '../ScriptSettingsProps.d';

interface RowEditorProps {
  field: ListField;
  value: any;
  onChange: (next: any) => void;
}

const RowCell: FC<RowEditorProps> = ({ field, value, onChange }) => {
  switch (field.type) {
    case 'input': {
      if (field.inputType === 'number') {
        return (
          <InputNumber
            value={typeof value === 'number' ? value : undefined}
            placeholder={field.placeholder}
            onChange={(v) => onChange(v ?? undefined)}
            style={{ width: '100%' }}
          />
        );
      }
      if (field.inputType === 'password') {
        return (
          <Input.Password
            value={value ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      }
      return (
        <Input
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    case 'switch':
      return <Switch checked={!!value} onChange={onChange} />;
    case 'slider':
      return (
        <InputNumber
          value={typeof value === 'number' ? value : undefined}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(v) => onChange(v ?? undefined)}
          style={{ width: '100%' }}
        />
      );
    case 'select':
      return (
        <Select
          value={value ?? undefined}
          options={field.options || []}
          onChange={onChange}
          style={{ width: '100%' }}
          allowClear
        />
      );
    case 'altSelect':
      return (
        <Input
          value={value ?? ''}
          placeholder="Alt name"
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return null;
  }
};

const ListOption: FC<{
  option: ScriptSettingsProps_List;
  onChange?: (e: any, option: ScriptSettingProps) => void;
  value: Record<string, any>[] | undefined;
}> = ({ option, onChange, value }) => {
  const rows: Record<string, any>[] = Array.isArray(value)
    ? value
    : option.defaultValue || [];
  const minItems = option.minItems ?? 0;
  const maxItems = option.maxItems ?? Infinity;

  const dispatch = (next: Record<string, any>[]) =>
    onChange?.(next as any, option);

  const updateCell = (rowIdx: number, key: string, v: any) =>
    dispatch(rows.map((r, i) => (i === rowIdx ? { ...r, [key]: v } : r)));

  const addRow = () => {
    if (rows.length >= maxItems) return;
    const blank: Record<string, any> = {};
    for (const f of option.fields) blank[f.key] = undefined;
    dispatch([...rows, blank]);
  };

  const removeRow = (idx: number) => {
    if (rows.length <= minItems) return;
    dispatch(rows.filter((_, i) => i !== idx));
  };

  const columns: TableProps<any>['columns'] = [
    ...option.fields.map((f) => ({
      title: f.label,
      key: f.key,
      dataIndex: f.key,
      render: (_: any, _row: any, rowIdx: number) => (
        <RowCell
          field={f}
          value={rows[rowIdx]?.[f.key]}
          onChange={(v) => updateCell(rowIdx, f.key, v)}
        />
      ),
    })),
    {
      title: '',
      key: '_actions',
      width: 50,
      render: (_: any, _row: any, rowIdx: number) => (
        <Button
          type="text"
          icon={<DeleteOutlined />}
          disabled={rows.length <= minItems}
          onClick={() => removeRow(rowIdx)}
        />
      ),
    },
  ];

  return (
    <Form.Item  name={option.id} label={option.label} tooltip={option.tooltip}>
      <Table
        dataSource={rows.map((r, i) => ({ ...r, key: i }))}
        columns={columns}
        pagination={false}
        size="small"
        bordered
      />
      <Button
        icon={<PlusOutlined />}
        type="dashed"
        block
        style={{ marginTop: 8 }}
        onClick={addRow}
        disabled={rows.length >= maxItems}
      >
        {option.addLabel || 'Add row'}
      </Button>
    </Form.Item>
  );
};

export default ListOption;
