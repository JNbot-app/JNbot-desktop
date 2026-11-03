import React, { useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Flex,
  Space,
  Typography,
  theme,
} from 'antd';
import {
  PlayCircleOutlined,
  PoweroffOutlined,
  SwapOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

interface ProxyHeaderProps {
  isActive: boolean;
  connectedCount: number;
  onStartProxy: () => Promise<void>;
  onStopProxy: () => void;
}

const ProxyHeader: React.FC<ProxyHeaderProps> = ({
  isActive,
  connectedCount,
  onStartProxy,
  onStopProxy,
}) => {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    try {
      await onStartProxy();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      styles={{
        body: { padding: `${token.paddingMD}px ${token.paddingLG}px` },
      }}
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
            icon={<SwapOutlined style={{ fontSize: 22 }} />}
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
                JNbot Proxy
              </Title>
              <Badge
                status={isActive ? 'success' : 'default'}
                text={
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {isActive
                      ? connectedCount > 0
                        ? `Online (${connectedCount} player${connectedCount === 1 ? '' : 's'})`
                        : 'Online'
                      : 'Inactive'}
                  </Text>
                }
              />
            </Flex>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Intercept and inspect Minecraft network packets
            </Text>
          </div>
        </Flex>

        <Space wrap size="small">
          {isActive ? (
            <Button
              danger
              type="primary"
              icon={<PoweroffOutlined />}
              onClick={onStopProxy}
            >
              Stop Proxy
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={loading}
              onClick={handleStart}
            >
              Start Proxy
            </Button>
          )}
        </Space>
      </Flex>
    </Card>
  );
};

export default ProxyHeader;
