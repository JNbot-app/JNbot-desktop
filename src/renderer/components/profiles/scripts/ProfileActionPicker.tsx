import { FC, useMemo, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Typography,
  message as antdMessage,
  theme,
} from 'antd';
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  useSettingsStore,
  selectMacros,
  upsertMacro,
} from '../../../redux/settings';
import { createProfileActionPlugin } from './createProfileActionPlugin';
import { useResolveScript } from './useResolveScript';
import { importFromFile, type ImportedSource } from './scriptImport';
import UrlImportInput from './UrlImportInput';
import {
  SOURCE_LABELS,
  type ProfileScript,
} from '../../../../common/profileScripts';
import type { MacroInfo, MacroScriptType } from '../../../../main/src/types';

const { Text } = Typography;

interface MacrosState {
  loaded: boolean;
  list: MacroInfo[];
}

interface Props {
  /**
   * Macro script type this picker manages. The legacy bot-extension slot
   * also accepts actions and creates new actions.
   */
  scriptType: MacroScriptType;
  /** Currently selected action, or `undefined` to show the picker. */
  value: ProfileScript | undefined;
  onChange: (next: ProfileScript | undefined) => void;
  /** Title for the empty-list card. */
  candidatesTitle: string;
  /** Title + initial values for the "Create new" modal. */
  createModal: {
    title: string;
    defaultName: string;
    defaultDescription: string;
    helpText: string;
  };
  /** Footer hint shown beneath the picker. Optional. */
  footer?: React.ReactNode;
}

const newId = () =>
  `pa_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Shared picker UI for wizard steps that bind a single `ProfileScript`
 * to the profile (currently: profile UI and bot action).
 * Handles selecting an existing plugin, importing a `.jnp` file, and
 * creating a plugin without leaving the wizard. The actual "use this"
 * call lives upstream — we just emit a
 * `ProfileScript` via `onChange`.
 */
const ProfileActionPicker: FC<Props> = ({
  scriptType,
  value,
  onChange,
  candidatesTitle,
  createModal,
  footer,
}) => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const macros =
    (useSettingsStore(selectMacros) as MacrosState | undefined)?.list ?? [];

  const candidates = useMemo(
    () =>
      macros.filter(
        (m) =>
          m.scriptType === scriptType ||
          (scriptType === 'botExtension' && m.scriptType === 'action'),
      ),
    [macros, scriptType],
  );

  const resolved = useResolveScript(value ?? null);
  const editablePluginId =
    value?.source.kind === 'plugin' ? value.source.pluginId : null;

  const [creating, setCreating] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [createForm] = Form.useForm<{ name: string; description: string }>();

  const handleCreate = async () => {
    const values = await createForm.validateFields().catch(() => null);
    if (!values) return;
    const createdType = scriptType === 'botExtension' ? 'action' : scriptType;
    const res = await createProfileActionPlugin(
      createdType,
      values.name,
      values.description,
    );
    if ('error' in res) {
      antdMessage.error(res.error);
      return;
    }
    // Inject into Redux so the new plugin shows up immediately, then
    // ask the backend to broadcast its canonical list.
    if (!macros.find((m) => m.pluginId === res.pluginId)) {
      upsertMacro({
        name: values.name,
        description: values.description,
        pluginId: res.pluginId,
        scriptType: createdType,
        language: 'js',
      } as MacroInfo);
    }
    window.ipcRenderer.action('GET_MACROS');
    onChange(res.script);
    setCreating(false);
    createForm.resetFields();
  };

  const pickPlugin = (info: MacroInfo) => {
    onChange({
      id: newId(),
      pluginId: info.pluginId,
      source: { kind: 'plugin', pluginId: info.pluginId },
    });
  };

  const applyImported = (r: ImportedSource) => {
    onChange({
      id: newId(),
      pluginId: r.pluginId,
      source: r.source,
      checksum: r.checksum,
    });
  };

  const pickFile = async () => {
    const res = await importFromFile();
    if (!res.ok) {
      if (res.canceled) return;
      antdMessage.error(res.error ?? 'Failed to read file');
      return;
    }
    applyImported(res.result);
  };

  const editCode = () => {
    if (!editablePluginId) return;
    navigate(`/code/${editablePluginId}`);
  };

  return (
    <div>
      {value && (
        <Card
          size="small"
          style={{ marginTop: 16, borderColor: token.colorPrimary }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar
              shape="square"
              size={44}
              src={resolved.info?.banner || undefined}
              style={{ background: token.colorPrimaryBg, flex: 'none' }}
            >
              {(resolved.info?.name ?? '?')[0]?.toUpperCase()}
            </Avatar>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong>{resolved.info?.name ?? '(loading…)'}</Text>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {SOURCE_LABELS[value.source.kind]}
                {resolved.error ? ` · ${resolved.error}` : ''}
              </Text>
            </div>
            {editablePluginId && (
              <Button
                type="primary"
                size="small"
                icon={<EditOutlined />}
                onClick={editCode}
              >
                Edit code
              </Button>
            )}
            <Button
              danger
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => onChange(undefined)}
            />
          </div>
        </Card>
      )}

      {!value && (
        <div style={{ marginTop: 16 }}>
          <Space wrap style={{ marginBottom: 12 }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreating(true)}
            >
              Create new
            </Button>
            <Button icon={<FolderOpenOutlined />} onClick={pickFile}>
              Import from file
            </Button>
            <Button icon={<LinkOutlined />} onClick={() => setUrlOpen(true)}>
              Import from URL
            </Button>
          </Space>

          <Card
            size="small"
            title={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {candidatesTitle}{' '}
                {candidates.length ? `(${candidates.length})` : ''}
              </Text>
            }
            styles={{ body: { padding: 0 } }}
          >
            {candidates.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    No plugins yet — click <strong>Create new</strong>.
                  </Text>
                }
                style={{ padding: 24 }}
              />
            ) : (
              candidates.map((m) => (
                <div
                  key={m.pluginId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong>{m.name}</Text>
                    <Text
                      type="secondary"
                      style={{ display: 'block', fontSize: 12 }}
                    >
                      {m.description?.slice(0, 80) || 'No description'}
                    </Text>
                  </div>
                  <Button
                    type="primary"
                    size="small"
                    icon={<ApiOutlined />}
                    onClick={() => pickPlugin(m)}
                  >
                    Use
                  </Button>
                </div>
              ))
            )}
          </Card>

          {footer}
        </div>
      )}

      <Modal
        title={createModal.title}
        open={creating}
        onCancel={() => {
          setCreating(false);
          createForm.resetFields();
        }}
        onOk={handleCreate}
        okText="Create"
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{
            name: createModal.defaultName,
            description: createModal.defaultDescription,
          }}
          preserve={false}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Pick a name' }]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {createModal.helpText}
          </Text>
        </Form>
      </Modal>

      <Modal
        title="Import from URL"
        open={urlOpen}
        onCancel={() => setUrlOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Paste a link to a .jnp file. It's downloaded, checked for a valid
          plugin, then cached next to the profile.
        </Text>
        <UrlImportInput
          onImported={(r) => {
            applyImported(r);
            setUrlOpen(false);
          }}
        />
      </Modal>
    </div>
  );
};

export default ProfileActionPicker;
