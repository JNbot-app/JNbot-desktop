import React, { useState } from 'react';
import { Form, Input, Modal, Select, Segmented, Typography } from 'antd';
import {
  ThunderboltOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { MacroInfoValidator } from '../validators/MacroValidator';
import DisplayMacros from '../components/macros/DisplayMacros';
import { useSettingsStore } from '../redux/settings';
import { usePluginActions } from '../components/macros/usePluginActions';
import type {
  MacroInfo,
  MacroLanguage,
  MacroScriptType,
} from '../../main/src/types';

type FormValues = {
  name: string;
  description: string;
  language: MacroLanguage;
  scriptType: MacroScriptType;
};

const CreateMacroDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ name?: string; description?: string }>(
    {},
  );
  const selectedLanguage = Form.useWatch('language', form);
  const currentFolder = useSettingsStore((state) => state.pluginsUi.folder);
  const actions = usePluginActions();

  const onCreate = async () => {
    const { name, description, language } = form.getFieldsValue();
    const scriptType =
      language === 'recording' ? 'script' : form.getFieldValue('scriptType');
    const err = MacroInfoValidator(name, description);
    if (err) {
      setError(err);
      return;
    }
    setError({});
    setLoading(true);
    const selectedFolder =
      currentFolder &&
      currentFolder !== '__all__' &&
      currentFolder !== '__none__'
        ? currentFolder
        : undefined;
    try {
      const response = await window.ipcRenderer.get<
        MacroInfo & { status?: 'success' | 'error'; message?: string }
      >('CREATE_MACRO', {
        name,
        description,
        language,
        scriptType,
        folder: selectedFolder,
      });
      if (response.status !== 'success') {
        console.error('Create plugin error:', response.message);
        return;
      }
      if (response.status) {
        delete response.status;
      }

      if (selectedFolder) {
        actions.movePlugin(response.pluginId, selectedFolder);
      }

      window.ipcRenderer.action('GET_MACROS');
      onClose();
      navigate(
        (language === 'components'
          ? '/macros/'
          : language === 'recording'
            ? '/recordings/'
            : '/code/') + response.pluginId,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="New Plugin"
      open={open}
      onCancel={onClose}
      onOk={onCreate}
      okText="Create"
      confirmLoading={loading}
      destroyOnHidden
      maskClosable
      width={460}
      afterOpenChange={(o) => {
        if (o) {
          form.resetFields();
          setError({});
        }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: '',
          description: '',
          language: 'js' as MacroLanguage,
          scriptType: 'script' as MacroScriptType,
        }}
        onFinish={onCreate}
        preserve={false}
      >
        <Form.Item
          name="name"
          label="Name"
          validateStatus={error.name ? 'error' : undefined}
          help={error.name}
        >
          <Input placeholder="Plugin name" autoFocus />
        </Form.Item>
        <Form.Item
          name="description"
          label="Description"
          validateStatus={error.description ? 'error' : undefined}
          help={error.description}
        >
          <Input.TextArea placeholder="What does this plugin do?" rows={3} />
        </Form.Item>

        <Form.Item name="language" label="Language">
          <Select
            options={[
              { value: 'js', label: 'JavaScript' },
              { value: 'ts', label: 'TypeScript' },
              { value: 'components', label: 'Components' },
              { value: 'recording', label: 'Recording' },
            ]}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item
          name="scriptType"
          label="Type"
          hidden={selectedLanguage === 'recording'}
        >
          <Segmented
            block
            options={[
              { value: 'script', label: 'Plugin', icon: <FileTextOutlined /> },
              {
                value: 'action',
                label: 'Action',
                icon: <ThunderboltOutlined />,
              },
            ]}
          />
        </Form.Item>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {selectedLanguage === 'recording'
            ? 'Record a task in the JNbot client and replay it on clients or bots.'
            : 'Actions are short scripts you can run while a bot is online. Plugins run as full scripts.'}
        </Typography.Text>
      </Form>
    </Modal>
  );
};

const Macros: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DisplayMacros openDrawer={() => setOpen(true)} />
      <CreateMacroDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
};

export default Macros;
