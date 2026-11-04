import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Dropdown,
  Empty,
  Flex,
  Popconfirm,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { DeviceObj } from '../../../main/src/types';
import { selectDevices, useSettingsStore } from '../../redux/settings';
import useAppApi from '../../hooks/useAppApi';
import AddDevice from './AddDevice';
import DeviceSettings from './DeviceSettings';
import { ServerTypes } from './connectionUtils';
import {
  DEFAULT_REMOTE_PERMISSIONS,
  permissionPreset,
} from '../../../common/clientPermissions';

const { Text } = Typography;

const Devices = () => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const status = useSettingsStore(selectDevices);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DeviceObj | null>(null);
  const [editing, setEditing] = useState(false);

  const openDetails = (device: DeviceObj, edit = false) => {
    setSelectedDevice(device);
    setEditing(edit);
  };

  const disconnect = (device: DeviceObj) => {
    window.ipcRenderer.action('CLOSE_CONNECTION', { id: device.id });
    message.success(`${device.name} disconnected`);
  };

  const revoke = (device: DeviceObj) => {
    window.ipcRenderer.action('REMOVE_DEVICE', { id: device.id });
    message.success(`${device.name} revoked`);
  };

  const devices = status.devices ?? [];

  return (
    <Card
      title={
        <Flex align="center" justify="space-between" wrap="wrap" gap={token.marginSM}>
          <Flex align="center" gap={8}>
            <UserOutlined />
            <span>Authorized Access Links</span>
          </Flex>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            Create access link
          </Button>
        </Flex>
      }
      style={{
        borderColor: token.colorBorderSecondary,
        background: token.colorBgContainer,
      }}
    >
      {devices.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Your first access link will be created when remote access starts."
        />
      ) : (
        <Flex vertical gap={token.marginSM}>
          {devices.map((device) => {
            const online = device.connectionCount > 0;
            const permissionMask =
              device.permissions?.permissionMask ?? DEFAULT_REMOTE_PERMISSIONS;
            return (
              <div
                key={device.id}
                style={{
                  padding: `${token.paddingSM}px ${token.paddingMD}px`,
                  borderRadius: token.borderRadiusSM,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                  transition: 'all 0.15s ease',
                }}
              >
                <Flex align="center" justify="space-between" wrap="wrap" gap={token.marginSM}>
                  <Flex align="center" gap={token.marginSM} style={{ minWidth: 0 }}>
                    <Badge status={online ? 'success' : 'default'} />
                    <div style={{ minWidth: 0 }}>
                      <Flex align="center" gap={token.marginXS} wrap="wrap">
                        <Text strong style={{ fontSize: 14 }}>
                          {device.name}
                        </Text>
                        <Tag color="blue" style={{ margin: 0 }}>
                          {device.permissions?.profiles === '*'
                            ? 'All profiles'
                            : `${device.permissions?.profiles?.length ?? 0} profile${(device.permissions?.profiles?.length ?? 0) === 1 ? '' : 's'}`}
                        </Tag>
                        <Tag style={{ margin: 0 }}>
                          {permissionPreset(permissionMask) === 'full'
                            ? 'Full access'
                            : permissionPreset(permissionMask) === 'standard'
                              ? 'Standard access'
                              : 'Custom access'}
                        </Tag>
                        <Tag color={online ? 'success' : 'default'} style={{ margin: 0 }}>
                          {online ? 'Online' : 'Offline'}
                        </Tag>
                      </Flex>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {online
                          ? `${device.connectionCount} connected ${
                              device.connectionCount === 1 ? 'session' : 'sessions'
                            }`
                          : 'No active sessions'}
                      </Text>
                    </div>
                  </Flex>

                  <Space size="small">
                    <Button
                      type="link"
                      icon={<LinkOutlined />}
                      onClick={() => openDetails(device)}
                    >
                      Show link
                    </Button>

                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          {
                            key: 'edit',
                            label: 'Edit',
                            icon: <EditOutlined />,
                            onClick: () => openDetails(device, true),
                          },
                          online
                            ? {
                                key: 'disconnect',
                                label: 'Disconnect',
                                icon: <DisconnectOutlined />,
                                onClick: () => disconnect(device),
                              }
                            : null,
                          {
                            key: 'revoke',
                            danger: true,
                            label: (
                              <Popconfirm
                                title="Revoke this access link?"
                                description="The existing URL will stop working immediately."
                                okText="Revoke"
                                okButtonProps={{ danger: true }}
                                onConfirm={() => revoke(device)}
                              >
                                <span>Revoke</span>
                              </Popconfirm>
                            ),
                            icon: <DeleteOutlined />,
                          },
                        ],
                      }}
                    >
                      <Button type="text" icon={<MoreOutlined />} />
                    </Dropdown>
                  </Space>
                </Flex>
              </div>
            );
          })}
        </Flex>
      )}

      <AddDevice
        open={createOpen}
        server={status[ServerTypes.PEER2PEER]}
        onClose={() => setCreateOpen(false)}
      />
      <DeviceSettings
        device={selectedDevice}
        server={status[ServerTypes.PEER2PEER]}
        editInitially={editing}
        onClose={() => {
          setSelectedDevice(null);
          setEditing(false);
        }}
      />
    </Card>
  );
};

export default Devices;
