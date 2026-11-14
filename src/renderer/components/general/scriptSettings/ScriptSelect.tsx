import { FC, ReactNode, useMemo } from 'react';
import { Select, Space, type SelectProps } from 'antd';
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
} from '../../../../common/scriptKinds';
import type { RunnableScript } from '../../../hooks/useRunnableScripts';

const KIND_ICONS: Record<ScriptKind, ReactNode> = {
  profileScript: <UserOutlined />,
  action: <ThunderboltOutlined />,
  recording: <VideoCameraOutlined />,
  plugin: <AppstoreOutlined />,
  chain: <ApartmentOutlined />,
};

type Props = Omit<SelectProps<string | string[]>, 'options' | 'mode'> & {
  scripts: RunnableScript[];
  /** Kinds to offer; none allows every kind. */
  kinds?: readonly ScriptKind[];
  multiple?: boolean;
};

/** Searchable script picker, grouped by kind. Values are plugin ids. */
const ScriptSelect: FC<Props> = ({
  scripts,
  kinds,
  multiple,
  loading,
  placeholder,
  ...rest
}) => {
  const options = useMemo(
    () =>
      groupScriptsByKind(scripts, kinds).map((group) => ({
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
    [scripts, kinds],
  );

  return (
    <Select
      showSearch
      optionFilterProp="label"
      maxTagCount="responsive"
      style={{ width: '100%' }}
      {...rest}
      mode={multiple ? 'multiple' : undefined}
      loading={loading}
      placeholder={placeholder ?? (multiple ? 'Select scripts...' : 'Select a script...')}
      options={options}
      // A saved id with no matching option would otherwise show as raw text.
      labelRender={({ label, value }) =>
        label !== undefined && label !== value
          ? label
          : loading
            ? 'Loading...'
            : 'Unavailable script'
      }
    />
  );
};

export default ScriptSelect;
