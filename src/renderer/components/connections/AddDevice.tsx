import { useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Space,
} from 'antd';
import type { Device, JNbotServerStatus } from '../../../main/src/types';
import useAppApi from '../../hooks/useAppApi';
import ConnectionDetails from './ConnectionDetails';
import ProfileSelector from '../ProfileSelector';
import PermissionEditor from './PermissionEditor';
import {
  DEFAULT_REMOTE_PERMISSIONS,
  FULL_REMOTE_PERMISSIONS,
} from '../../../common/clientPermissions';
import { selectAppSettings, useSettingsStore } from '../../redux/settings';

interface AddDeviceProps {
  open: boolean;
  server: JNbotServerStatus['peer2peer'];
  onClose: () => void;
}

const AddDevice = ({ open, server, onClose }: AddDeviceProps) => {
  const [form] = Form.useForm<{ name: string; profiles: string[]; permissionMask: number }>();
  const { message } = useAppApi();
  const [device, setDevice] = useState<Device>();
  const [loading, setLoading] = useState(false);
  const appSettings = useSettingsStore(selectAppSettings);
  const permissionMask = Form.useWatch('permissionMask', form);

  useEffect(() => {
    if (permissionMask === FULL_REMOTE_PERMISSIONS) {
      form.setFieldValue('profiles', ['*']);
    }
  }, [form, permissionMask]);

  const close = () => {
    form.resetFields();
    setDevice(undefined);
    onClose();
  };

  const create = async ({
    name,
    profiles: selectedProfiles,
    permissionMask,
  }: {
    name: string;
    profiles: string[];
    permissionMask: number;
  }) => {
    setLoading(true);
    try {
      const created = await window.ipcRenderer.get<Device>('CREATE_DEVICE', {
        name: name.trim(),
        permissions: {
          profiles:
            permissionMask === FULL_REMOTE_PERMISSIONS ||
            selectedProfiles.includes('*')
              ? '*'
              : selectedProfiles,
          permissionMask,
          mcp: {
            enabled: false,
            observe: 'allow',
            control: 'allow',
            code: 'ask',
            plugins: 'ask',
          },
        },
      });
      setDevice(created);
      message.success('Access link created');
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : 'The access link could not be created',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={device ? `Access link ready - ${device.name}` : 'Create access link'}
      open={open}
      width={device ? 620 : 520}
      onCancel={close}
      footer={
        device
          ? [
              <Button key="done" type="primary" onClick={close}>
                Done
              </Button>,
            ]
          : null
      }
      destroyOnHidden
    >
      {device ? (
        <ConnectionDetails server={server} device={device} />
      ) : (
        <Form
          form={form}
          layout="vertical"
          onFinish={create}
          requiredMark={false}
          initialValues={{ profiles: appSettings.server ? [appSettings.server] : [], permissionMask: DEFAULT_REMOTE_PERMISSIONS }}
        >
          <Form.Item
            name="name"
            label="Device name"
            rules={[
              {
                required: true,
                whitespace: true,
                message: 'Enter a device name',
              },
              { max: 25, message: 'Use 25 characters or fewer' },
            ]}
          >
            <Input autoFocus maxLength={25} showCount placeholder="My phone" />
          </Form.Item>
          <Form.Item name="permissionMask" label="Additional access">
            <PermissionEditor />
          </Form.Item>
          <Form.Item
            name="profiles"
            label="Allowed profiles"
            rules={[{ required: true, message: 'Choose at least one profile or all profiles.' }]}
          >
            <ProfileSelector
              disabled={permissionMask === FULL_REMOTE_PERMISSIONS}
              includeAll
              placeholder="Choose profiles"
            />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={close}>Cancel</Button>
            <Button type="primary" loading={loading} onClick={form.submit}>
              Create link
            </Button>
          </Space>
        </Form>
      )}
    </Modal>
  );
};

export default AddDevice;
