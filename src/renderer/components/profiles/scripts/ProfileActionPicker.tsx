import { FC, useMemo, useState } from 'react';
import {
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Space,
  Typography,
  message as antdMessage,
  theme,
} from 'antd';
import {
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
import ScriptSelect from '../../general/scriptSettings/ScriptSelect';
import {
  SOURCE_LABELS,
  type ProfileScript,
} from '../../../../common/profileScripts';
import type { MacroInfo, MacroScriptType } from '../../../../main/src/types';

const { Text } = Typography;

const NO_MACROS: MacroInfo[] = [];

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
  /** Currently selected action, if any. */
  value: ProfileScript | undefined;
  onChange: (next: ProfileScript | undefined) => void;
  /** Placeholder of the plugin selector. */
  placeholder: string;
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
 * to the profile (profile UI, bot action, gamemode join actions).
 * Handles selecting an existing plugin, importing a `.jnp` file, and
 * creating a plugin without leaving the wizard. The actual "use this"
 * call lives upstream — we just emit a
 * `ProfileScript` via `onChange`.
 */
const ProfileActionPicker: FC<Props> = ({
  scriptType,
  value,
  onChange,
  placeholder,
  createModal,
  footer,
}) => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const macros =
    (useSettingsStore(selectMacros) as MacrosState | undefined)?.list ?? NO_MACROS;

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

  // Bundled / URL references are not in the library; list them so the
  // selector can still show their name.
  const scripts = useMemo(() => {
    const list = candidates.map((info) => ({ info }));
    if (value && !candidates.some((m) => m.pluginId === value.pluginId)) {
      list.push({
        info: resolved.info ?? ({ pluginId: value.pluginId, name: value.pluginId } as MacroInfo),
      });
    }
    return list;
  }, [candidates, value, resolved.info]);

  const select = (pluginId?: string) => {
    if (!pluginId) return onChange(undefined);
    const info = candidates.find((m) => m.pluginId === pluginId);
    if (info && pluginId !== value?.pluginId) pickPlugin(info);
  };

  return (
    <Flex vertical gap={token.marginXS}>
      <ScriptSelect
        scripts={scripts}
        value={value?.pluginId}
        onChange={(id) => select(id as string | undefined)}
        loading={resolved.loading}
        allowClear
        placeholder={placeholder}
        status={resolved.error ? 'error' : undefined}
      />
      {value && value.source.kind !== 'plugin' && (
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {SOURCE_LABELS[value.source.kind]}
          {resolved.error ? ` · ${resolved.error}` : ''}
        </Text>
      )}
      <Space wrap>
        {editablePluginId && (
          <Button icon={<EditOutlined />} onClick={editCode}>
            Edit code
          </Button>
        )}
        <Button icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          Create new
        </Button>
        <Button icon={<FolderOpenOutlined />} onClick={pickFile}>
          Import from file
        </Button>
        <Button icon={<LinkOutlined />} onClick={() => setUrlOpen(true)}>
          Import from URL
        </Button>
      </Space>
      {footer}

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
    </Flex>
  );
};

export default ProfileActionPicker;
