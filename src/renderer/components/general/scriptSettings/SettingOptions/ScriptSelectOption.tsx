import { FC, memo, ReactNode, useMemo } from 'react';
import { Form, Select, Space } from 'antd';
import {
  AppstoreOutlined,
  ApartmentOutlined,
  ThunderboltOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {
  groupScriptsByKind,
  type ScriptKind,
} from '../../../../../common/scriptKinds';
import { useRunnableScripts } from '../../../../hooks/useRunnableScripts';
import {
  ScriptSettingProps,
  ScriptSettingsProps_ScriptSelect,
} from '../ScriptSettingsProps.d';

const KIND_ICONS: Record<ScriptKind, ReactNode> = {
  profileScript: <UserOutlined />,
  action: <ThunderboltOutlined />,
  recording: <VideoCameraOutlined />,
  plugin: <AppstoreOutlined />,
  chain: <ApartmentOutlined />,
};

const ScriptSelectOption: FC<{
  option: ScriptSettingsProps_ScriptSelect;
  onChange?: (e: string | string[], option: ScriptSettingProps) => void;
}> = ({ option, onChange }) => {
  const { scripts, loading } = useRunnableScripts();
  const multiple = option.multiple === true;

  const options = useMemo(
    () =>
      groupScriptsByKind(scripts, option.kinds).map((group) => ({
        title: group.label,
        label: (
          <Space size={6}>
            {KIND_ICONS[group.kind]}
            {group.label}
          </Space>
        ),
        options: group.scripts.map(({ info }) => ({
          label: info.name,
          value: info.pluginId,
        })),
      })),
    [scripts, option.kinds],
  );

  return (
    <Form.Item
      label={option.label}
      name={option.id}
      tooltip={option.tooltip}
      style={{ width: '100%', maxWidth: multiple ? 420 : 360 }}
    >
      <Select
        id={option.id}
        mode={multiple ? 'multiple' : undefined}
        allowClear={option.clearable !== false}
        showSearch
        optionFilterProp="label"
        loading={loading}
        placeholder={
          option.placeholder ??
          (multiple ? 'Select scripts...' : 'Select a script...')
        }
        className={option.className}
        style={{ width: '100%' }}
        maxTagCount="responsive"
        options={options}
        // A saved id with no matching option would otherwise show as raw text.
        labelRender={({ label, value }) =>
          label !== undefined && label !== value
            ? label
            : loading
              ? 'Loading...'
              : 'Unavailable script'
        }
        onChange={(next?: string | string[]) =>
          onChange?.(next ?? (multiple ? [] : ''), option)
        }
      />
    </Form.Item>
  );
};

export default memo(ScriptSelectOption);
