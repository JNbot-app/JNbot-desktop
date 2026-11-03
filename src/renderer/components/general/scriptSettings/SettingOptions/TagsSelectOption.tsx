import { FC } from 'react';
import { Form, Select, Typography } from 'antd';
import { useSettingsStore, selectAltTags } from '../../../../redux/settings';
import type {
  ScriptSettingProps,
  ScriptSettingsProps_TagsSelect,
} from '../ScriptSettingsProps.d';

const TagsSelectOption: FC<{
  option: ScriptSettingsProps_TagsSelect;
  onChange?: (
    e: number | string | (string | string[] | number[])[],
    option: ScriptSettingProps,
  ) => void;
  value: string[];
}> = ({ option, onChange, value }) => {
  const tags = useSettingsStore(selectAltTags);

  const options = tags.map((t) => ({
    value: t.id,
    label: t.name,
    color: t.color,
    count: t.alts.length,
  }));

  return (
    <Form.Item
      label={option.label}
      name={option.id}
      tooltip={option.tooltip}
      style={{ maxWidth: '400px', width: '100%', minWidth: '200px' }}
    >
      <Select
        mode="multiple"
        value={value}
        onChange={(newVal) => onChange?.(newVal, option)}
        style={{ width: '100%' }}
        placeholder={tags.length === 0 ? 'No tags defined' : option.label}
        className={option.className}
        options={options}
        optionFilterProp="label"
        notFoundContent="No tags — create one from the Alts tab."
        tagRender={({ value: id, closable, onClose }) => {
          const tag = tags.find((t) => t.id === id);
          if (!tag) return <span />;
          return (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: tag.color,
                color: '#fff',
                borderRadius: 4,
                padding: '0 8px',
                margin: '2px 4px 2px 0',
                fontSize: 12,
                lineHeight: '20px',
              }}
            >
              {tag.name}
              {closable && (
                <span
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={onClose}
                  style={{ cursor: 'pointer', opacity: 0.8 }}
                >
                  ×
                </span>
              )}
            </span>
          );
        }}
        optionRender={(opt) => {
          const tag = tags.find((t) => t.id === opt.value);
          if (!tag) return opt.label;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: tag.color,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{tag.name}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {tag.alts.length} alt{tag.alts.length === 1 ? '' : 's'}
              </Typography.Text>
            </div>
          );
        }}
      />
    </Form.Item>
  );
};

export default TagsSelectOption;
