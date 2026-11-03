import React from 'react';
import { Avatar, Badge, Button, Card, Flex, Space, Typography, theme } from 'antd';
import {
  CloudServerOutlined,
  LinkOutlined,
  PlusOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

interface ServerHeaderProps {
  totalServers: number;
  onlineServers: number;
  onCreate: () => void;
  onJoin: () => void;
  onShare: () => void;
}

const ServerHeader: React.FC<ServerHeaderProps> = ({
  totalServers,
  onlineServers,
  onCreate,
  onJoin,
  onShare,
}) => {
  const { token } = theme.useToken();

  return (
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
            icon={<CloudServerOutlined style={{ fontSize: 22 }} />}
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
                Minecraft Servers
              </Title>
              <Badge
                status={onlineServers > 0 ? 'success' : 'default'}
                text={
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {onlineServers > 0
                      ? `${onlineServers} online`
                      : totalServers > 0
                        ? `${totalServers} server${totalServers === 1 ? '' : 's'}`
                        : 'No servers'}
                  </Text>
                }
              />
            </Flex>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Host and join private worlds securely without port forwarding
            </Text>
          </div>
        </Flex>

        <Space wrap size="small">
          <Button icon={<LinkOutlined />} onClick={onJoin}>
            Join Invite
          </Button>
          <Button icon={<ShareAltOutlined />} onClick={onShare}>
            Share World
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            Create Server
          </Button>
        </Space>
      </Flex>
    </Card>
  );
};

export default ServerHeader;
