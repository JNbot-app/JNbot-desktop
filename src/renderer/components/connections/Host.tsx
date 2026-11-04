import { useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Flex,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  MobileOutlined,
  PoweroffOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { Device } from '../../../main/src/types';
import { selectDevices, useSettingsStore } from '../../redux/settings';
import useAppApi from '../../hooks/useAppApi';
import ConnectionDetails from './ConnectionDetails';
import {
  ServerTypes,
  buildAccessUrl,
  buildMobileAccessUrl,
} from './connectionUtils';

const { Title, Text } = Typography;

const Host = () => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const status = useSettingsStore(selectDevices);
  const server = status[ServerTypes.PEER2PEER];
  const [loading, setLoading] = useState(false);
  const [startedDevice, setStartedDevice] = useState<Device>();

  const device = startedDevice ?? status.devices[0];
  const isRunning = Boolean(server?.status);

  const start = async () => {
    setLoading(true);
    try {
      const result = await window.ipcRenderer.get<{
        device: Device;
      }>('TURN_ON_SERVER', { server: ServerTypes.PEER2PEER });
      setStartedDevice(result.device);
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : 'Remote access could not be started',
      );
    } finally {
      setLoading(false);
    }
  };

  const stop = async () => {
    setLoading(true);
    try {
      await window.ipcRenderer.get('TURN_OFF_SERVER', {
        server: ServerTypes.PEER2PEER,
      });
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : 'Remote access could not be stopped',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex vertical gap={token.marginMD}>
      {/* Header Card */}
      <Card
        styles={{ body: { padding: `${token.paddingMD}px ${token.paddingLG}px` } }}
        style={{
          borderColor: token.colorBorderSecondary,
          background: token.colorBgContainer,
        }}
      >
        <Flex
          justify="space-between"
          align="center"
          wrap="wrap"
          gap={token.marginMD}
        >
          <Flex align="center" gap={token.marginMD} wrap="wrap">
            <Avatar
              shape="square"
              size={44}
              icon={<MobileOutlined style={{ fontSize: 22 }} />}
              style={{
                background: token.colorPrimaryBg,
                color: token.colorPrimary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
            <div>
              <Flex align="center" gap={10} wrap="wrap">
                <Title level={4} style={{ margin: 0 }}>
                  Remote Access
                </Title>
                <Badge
                  status={isRunning ? 'success' : 'default'}
                  text={
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {isRunning ? 'Online' : 'Stopped'}
                    </Text>
                  }
                />
              </Flex>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Control JNbot securely from a phone, tablet, or another computer
              </Text>
            </div>
          </Flex>

          <Space wrap size="small">
            {isRunning ? (
              <Button
                danger
                icon={<PoweroffOutlined />}
                loading={loading}
                onClick={stop}
              >
                Stop Remote Access
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<PoweroffOutlined />}
                loading={loading}
                onClick={start}
              >
                Start Remote Access
              </Button>
            )}
          </Space>
        </Flex>
      </Card>

      {/* Connection Workspace */}
      {isRunning ? (
        <Card
          title={
            <Flex align="center" justify="space-between">
              <Space>
                <Badge status="success" />
                <span>Live Connection</span>
                {device?.name && (
                  <Tag color="blue">{device.name}</Tag>
                )}
              </Space>
            </Flex>
          }
          style={{
            borderColor: token.colorBorderSecondary,
            background: token.colorBgContainer,
          }}
        >
          <ConnectionDetails server={server} device={device} />
        </Card>
      ) : (
        <Card
          style={{
            borderColor: token.colorBorderSecondary,
            background: token.colorBgContainer,
            textAlign: 'center',
            padding: `${token.paddingMD}px 0`,
          }}
        >
          <Flex vertical align="center" gap={token.marginSM} style={{ maxWidth: 520, margin: '0 auto' }}>
            <SafetyCertificateOutlined style={{ fontSize: 40, color: token.colorPrimary }} />
            <Title level={4} style={{ margin: 0 }}>
              Access JNbot Anywhere
            </Title>
            <Text type="secondary">
              Start remote access to generate a secure peer-to-peer connection link. You can scan the QR code or share links with your authorized devices.
            </Text>
            <Button
              type="primary"
              icon={<PoweroffOutlined />}
              loading={loading}
              onClick={start}
              style={{ marginTop: token.marginXS }}
            >
              Start Remote Access
            </Button>
          </Flex>
        </Card>
      )}
    </Flex>
  );
};

export { buildAccessUrl, buildMobileAccessUrl };
export default Host;
