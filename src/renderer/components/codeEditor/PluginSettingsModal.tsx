import React, { useEffect, useState } from 'react';
import {
  Modal,
  Tabs,
  Input,
  Button,
  Typography,
  Form,
  Space,
  Select,
  Popconfirm,
} from 'antd';
import {
  InfoCircleOutlined,
  PictureOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { MacroInfo } from '../macros/types';

import SettingsBuilder from '../general/scriptSettings/SettingsBuilder';
import type { ScriptSettingsSection } from '../general/scriptSettings/ScriptSettingsProps.d';
import { useNavigate } from 'react-router-dom';

const { TextArea } = Input;
const { Text, Title } = Typography;

interface PluginSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  macroData: MacroInfo;
  onSave: (updatedMacro: MacroInfo) => void;
}

const PluginSettingsModal: React.FC<PluginSettingsModalProps> = ({
  visible,
  onClose,
  macroData,
  onSave,
}) => {
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('general');
  const [bannerUrl, setBannerUrl] = useState(macroData.banner || '');
  const [configSections, setConfigSections] = useState<ScriptSettingsSection[]>(
    macroData.config || [],
  );
  const navigate = useNavigate();

  // Sync the form/config from `macroData` only when the modal opens. Re-running
  // this on every `macroData` identity change (the parent recreates the object
  // on unrelated re-renders) would clobber unsaved builder edits — e.g. options
  // just added would be reverted to the last saved config.
  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue({
      name: macroData.name,
      description: macroData.description,
      scriptType: macroData.scriptType,
      banner: macroData.banner || '',
    });
    setBannerUrl(macroData.banner || '');
    setConfigSections(macroData.config || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleSave = () => {
    form.validateFields().then((values) => {
      const updatedMacro: MacroInfo = {
        ...macroData,
        name: values.name,
        description: values.description,
        scriptType: values.scriptType,
        banner: values.banner || undefined,
        config: configSections.length > 0 ? configSections : undefined,
      };
      onSave(updatedMacro);
      onClose();
    });
  };

  const deleteMacro = () => {
    if (!macroData) return;
    window.ipcRenderer.get('DELETE_MACRO', macroData);
    setTimeout(() => navigate('/plugins'), 250);
  };

  return (
    <Modal
      title={`Edit Plugin: ${macroData.name}`}
      open={visible}
      onCancel={onClose}
      footer={[
        <Popconfirm
          key="delete"
          title="Are you sure to delete this plugin?"
          onConfirm={deleteMacro}
          okText="Delete"
          cancelText="No"
          okButtonProps={{ danger: true }}
        >
          <Button danger>Delete</Button>
        </Popconfirm>,
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="save" type="primary" onClick={handleSave}>
          Save Changes
        </Button>,
      ]}
      width={860}
      styles={{ body: { padding: '12px 0 0' } }}
    >
      <Form form={form} layout="vertical">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'general',
              forceRender: true,
              label: (
                <span>
                  <InfoCircleOutlined /> General
                </span>
              ),
              children: (
                <div style={{ padding: '0 24px' }}>
                  <Form.Item
                    name="name"
                    label="Plugin Name"
                    rules={[
                      { required: true, message: 'Please enter a plugin name' },
                      { max: 60, message: 'Name must be 60 characters or fewer' },
                      { whitespace: true, message: 'Name cannot be blank' },
                    ]}
                  >
                    <Input placeholder="Enter plugin name" showCount maxLength={60} />
                  </Form.Item>

                  <Form.Item
                    name="description"
                    label="Description"
                    rules={[
                      { max: 300, message: 'Description must be 300 characters or fewer' },
                    ]}
                  >
                    <TextArea
                      rows={4}
                      placeholder="Describe what your plugin does..."
                      showCount
                      maxLength={300}
                    />
                  </Form.Item>

                  <Form.Item name="scriptType" label="Type">
                    <Select>
                      <Select.Option value="script">Plugin</Select.Option>
                      <Select.Option value="action">Action</Select.Option>
                      <Select.Option value="profileUi">Profile UI</Select.Option>
                      <Select.Option value="botExtension" disabled>Bot extension (deprecated)</Select.Option>
                    </Select>
                  </Form.Item>
                </div>
              ),
            },
            {
              key: 'config',
              forceRender: true,
              label: (
                <span>
                  <SettingOutlined /> Configuration
                </span>
              ),
              children: (
                <div style={{ padding: '0 24px' }}>
                  <SettingsBuilder
                    sections={configSections}
                    onChange={setConfigSections}
                    title="Plugin Configuration"
                    description="Define settings that users can customize when using your plugin"
                  />
                </div>
              ),
            },
            {
              key: 'media',
              forceRender: true,
              label: (
                <span>
                  <PictureOutlined /> Banner
                </span>
              ),
              children: (
                <div style={{ padding: '0 24px' }}>
                  <Space orientation="vertical" size="large" style={{ width: '100%' }}>
                    <div>
                      <Title level={5} style={{ marginBottom: 4 }}>
                        Banner Image
                      </Title>
                      <Text type="secondary">
                        Add a banner image for your plugin.
                      </Text>
                    </div>

                    <Form.Item
                      name="banner"
                      label="Banner URL"
                      rules={[
                        { type: 'url', message: 'Please enter a valid URL', warningOnly: false },
                        { max: 500, message: 'URL is too long' },
                      ]}
                    >
                      <Input
                        placeholder="https://example.com/banner.jpg"
                        onChange={(e) => setBannerUrl(e.target.value)}
                        allowClear
                      />
                    </Form.Item>

                    {bannerUrl && (
                      <div>
                        <Text strong>Preview</Text>
                        <div
                          style={{
                            marginTop: '8px',
                            width: '100%',
                            height: '200px',
                            background: `url(${bannerUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            borderRadius: '8px',
                            border: '1px solid #d9d9d9',
                          }}
                        />
                      </div>
                    )}

                    <Text type="secondary">
                      <strong>Tip:</strong> Use high-quality images (recommended size:
                      800×200px) for the best appearance.
                    </Text>
                  </Space>
                </div>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
};

export default PluginSettingsModal;
