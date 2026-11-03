import { useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
} from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { DeviceObj, JNbotServerStatus } from '../../../main/src/types';
import useAppApi from '../../hooks/useAppApi';
import ConnectionDetails from './ConnectionDetails';
import ProfileSelector from '../ProfileSelector';
import PermissionEditor from './PermissionEditor';
import {
  DEFAULT_REMOTE_PERMISSIONS,
  FULL_REMOTE_PERMISSIONS,
} from '../../../common/clientPermissions';

interface DeviceSettingsProps {
  device: DeviceObj | null;
  server: JNbotServerStatus['peer2peer'];
  renameInitially?: boolean;
  editInitially?: boolean;
  onClose: () => void;
}

const DeviceSettings = ({
  device,
  server,
  renameInitially = false,
  editInitially = false,
  onClose,
}: DeviceSettingsProps) => {
  const [form] = Form.useForm<{ name: string; profiles: string[]; permissionMask: number }>();
  const { message } = useAppApi();
  const [isEditing, setIsEditing] = useState(false);
  const permissionMask = Form.useWatch('permissionMask', form);

  const shouldStartEditing = editInitially || renameInitially;

  useEffect(() => {
    setIsEditing(shouldStartEditing);
    if (device) {
      form.setFieldsValue({
        name: device.name,
        profiles:
          device.permissions?.profiles === '*'
            ? ['*']
            : device.permissions?.profiles ?? [],
        permissionMask: device.permissions?.permissionMask ?? DEFAULT_REMOTE_PERMISSIONS,
      });
    }
  }, [device, form, shouldStartEditing]);

  useEffect(() => {
    if (permissionMask === FULL_REMOTE_PERMISSIONS) {
      form.setFieldValue('profiles', ['*']);
    }
  }, [form, permissionMask]);

  const save = ({
    name,
    profiles: selectedProfiles,
    permissionMask,
  }: {
    name: string;
    profiles: string[];
    permissionMask: number;
  }) => {
    if (!device) return;
    window.ipcRenderer.action('UPDATE_DEVICE', {
      id: device.id,
      name: name.trim(),
    });
    window.ipcRenderer.action('UPDATE_DEVICE_PERMISSIONS', {
      id: device.id,
      permissions: {
        profiles:
          permissionMask === FULL_REMOTE_PERMISSIONS ||
          selectedProfiles.includes('*')
            ? '*'
            : selectedProfiles,
        permissionMask,
        mcp: device.permissions?.mcp ?? {
          enabled: false,
          observe: 'allow',
          control: 'allow',
          code: 'ask',
          plugins: 'ask',
        },
      },
    });
    message.success('Access link updated');
    onClose();
  };

  return (
    <Modal
      title={
        isEditing
          ? `Edit ${device?.name ?? 'access link'}`
          : device?.name
      }
      open={!!device}
      width={620}
      onCancel={onClose}
      footer={
        isEditing
          ? [
              <Button
                key="cancel"
                onClick={() => (shouldStartEditing ? onClose() : setIsEditing(false))}
              >
                Cancel
              </Button>,
              <Button key="save" type="primary" onClick={form.submit}>
                Save
              </Button>,
            ]
          : [
              <Button
                key="edit"
                icon={<EditOutlined />}
                onClick={() => setIsEditing(true)}
              >
                Edit
              </Button>,
              <Button key="done" type="primary" onClick={onClose}>
                Done
              </Button>,
            ]
      }
      destroyOnHidden
    >
      {isEditing ? (
        <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
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
            <Input autoFocus maxLength={25} showCount />
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
        </Form>
      ) : (
        <ConnectionDetails server={server} device={device ?? undefined} />
      )}
    </Modal>
  );
};

export default DeviceSettings;
