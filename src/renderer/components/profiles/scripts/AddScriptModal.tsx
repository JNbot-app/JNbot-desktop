import { FC, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Input,
  List,
  Modal,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useSettingsStore, selectMacros } from '../../../redux/settings';
import type { ProfileScript } from '../../../../common/profileScripts';
import type { MacroInfo } from '../../../../main/src/types';
import { importFromFile, type ImportedSource } from './scriptImport';
import UrlImportInput from './UrlImportInput';
import useAppApi from 'renderer/hooks/useAppApi';

const { Text } = Typography;

type SourceTab = 'plugin' | 'bundled' | 'url';
type TypeFilter = 'all' | 'script' | 'action';

interface Props {
  open: boolean;
  onClose: () => void;
  /** pluginIds already on the profile — used to disable duplicates. */
  existingPluginIds: Set<string>;
  onAdd: (script: ProfileScript) => void;
  /** Override the modal title (defaults to "Add a script"). */
  title?: string;
  /** Restrict selection to installed plugins; skip file and URL imports. */
  pluginOnly?: boolean;
}

const newId = () =>
  `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Add a script to a profile. Three ways: pick one of the user's existing
 * plugins, import a `.jnp` file, or import from a URL. File and URL
 * imports both run through the shared `scriptImport` helpers, which validate
 * the payload is a real plugin before it is added.
 */
const AddScriptModal: FC<Props> = ({
  open,
  onClose,
  existingPluginIds,
  onAdd,
  title = 'Add a script',
  pluginOnly = false,
}) => {
  const [tab, setTab] = useState<SourceTab>('plugin');
  const macros = useSettingsStore(selectMacros).list;
  const [pluginQuery, setPluginQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const {message} = useAppApi()

  const filteredMacros = useMemo(() => {
    const q = pluginQuery.trim().toLowerCase();
    return (macros ?? [])
      // `profileUi` / `botExtension` plugins are bound to the profile via
      // their own wizard steps, not added to the dashboard script list.
      .filter(
        (m) =>
          pluginOnly ||
          (m.scriptType !== 'profileUi' && m.scriptType !== 'botExtension'),
      )
      .filter((m) => (typeFilter === 'all' ? true : m.scriptType === typeFilter))
      .filter((m) =>
        !q ? true : (m.name + (m.description ?? '')).toLowerCase().includes(q),
      );
  }, [macros, pluginQuery, typeFilter, pluginOnly]);

  const close = () => {
    setPluginQuery('');
    setTypeFilter('all');
    setTab('plugin');
    onClose();
  };

  const addPlugin = (info: MacroInfo) => {
    if (existingPluginIds.has(info.pluginId)) {
      message.info('This plugin is already on the profile');
      return;
    }
    onAdd({
      id: newId(),
      pluginId: info.pluginId,
      source: { kind: 'plugin', pluginId: info.pluginId },
    });
    close();
  };

  /** Shared finish step for file + URL imports. */
  const addImported = (r: ImportedSource) => {
    onAdd({
      id: newId(),
      pluginId: r.pluginId,
      source: r.source,
      checksum: r.checksum,
    });
    close();
  };

  const addBundled = async () => {
    const res = await importFromFile();
    if (!res.ok) {
      if (res.canceled) return;
      message.error(res.error ?? 'Failed to read file');
      return;
    }
    if (existingPluginIds.has(res.result.pluginId)) {
      message.info('This plugin is already on the profile');
      return;
    }
    addImported(res.result);
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      title={title}
      width={640}
      footer={null}
      destroyOnHidden
    >
      {!pluginOnly && (
        <Segmented
          block
          value={tab}
          onChange={(v) => setTab(v as SourceTab)}
          options={[
            { value: 'plugin', label: 'From my plugins', icon: <ApiOutlined /> },
            { value: 'bundled', label: 'From file', icon: <FolderOpenOutlined /> },
            { value: 'url', label: 'From URL', icon: <LinkOutlined /> },
          ]}
          style={{ marginBottom: 16 }}
        />
      )}

      {tab === 'plugin' && (
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Input.Search
            placeholder="Search your plugins…"
            value={pluginQuery}
            onChange={(e) => setPluginQuery(e.target.value)}
            allowClear
          />
          <Segmented
            size="small"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as TypeFilter)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'script', label: 'Scripts' },
              { value: 'action', label: 'Actions' },
            ]}
          />
          <List
            dataSource={filteredMacros}
            // Paginate so a large library renders only a handful of rows at a
            // time — keeps the modal snappy to open.
            pagination={
              filteredMacros.length > 6
                ? { pageSize: 6, size: 'small', align: 'center' }
                : false
            }
            locale={{
              emptyText:
                'No matching plugins — install one from the Plugins tab first.',
            }}
            renderItem={(m) => {
              const dup = existingPluginIds.has(m.pluginId);
              return (
                <List.Item
                  actions={[
                    <Button
                      key="add"
                      type="primary"
                      size="small"
                      disabled={dup}
                      onClick={() => addPlugin(m)}
                    >
                      {dup ? 'Added' : 'Add'}
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar shape="square" size={40} src={m.banner || undefined}>
                        {m.name?.[0]?.toUpperCase() ?? '?'}
                      </Avatar>
                    }
                    title={
                      <Space size={6}>
                        <Text>{m.name}</Text>
                        {m.scriptType === 'action' && (
                          <Tag color="purple" icon={<ThunderboltOutlined />}>
                            Action
                          </Tag>
                        )}
                      </Space>
                    }
                    description={
                      <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                        {m.description?.slice(0, 90) || 'No description'}
                      </Text>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </Space>
      )}

      {tab === 'bundled' && (
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            type="info"
            showIcon
            title="Pick a .jnp file"
            description="The file's code is copied next to the profile in an obfuscated form so it keeps working if you move or rename the original."
          />
          <Button
            icon={<FolderOpenOutlined />}
            type="primary"
            onClick={addBundled}
          >
            Choose file…
          </Button>
        </Space>
      )}

      {tab === 'url' && (
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            type="info"
            showIcon
            title="Import from a URL"
            description="Paste a link to a .jnp file. The code is re-downloaded each time the script runs, so you always get the latest version the author publishes."
          />
          <UrlImportInput
            existingPluginIds={existingPluginIds}
            onImported={addImported}
          />
        </Space>
      )}
    </Modal>
  );
};

export default AddScriptModal;
