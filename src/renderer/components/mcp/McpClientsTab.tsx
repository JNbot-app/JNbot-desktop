import React from 'react';
import { Button, Empty, Flex, Typography, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { McpClientGrant } from '../../../common/mcp';
import McpClientCard from './McpClientCard';

const { Text } = Typography;

interface McpClientsTabProps {
  clients: McpClientGrant[];
  onOpenConnectModal: () => void;
  onOpenPermissions: (client: McpClientGrant) => void;
  onTestConnection: (client: McpClientGrant) => void;
  onRotateToken: (client: McpClientGrant) => void;
  onRemoveClient: (client: McpClientGrant) => void;
}

const McpClientsTab: React.FC<McpClientsTabProps> = ({
  clients,
  onOpenConnectModal,
  ...cardActions
}) => {
  const { token } = theme.useToken();

  if (clients.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ padding: `${token.paddingXL}px 0` }}
        description={
          <Flex vertical gap={4}>
            <Text strong>No AI clients yet</Text>
            <Text type="secondary">
              Connect Claude, ChatGPT, Cursor or any MCP client to get started
            </Text>
          </Flex>
        }
      >
        <Button type="primary" icon={<PlusOutlined />} onClick={onOpenConnectModal}>
          Connect client
        </Button>
      </Empty>
    );
  }

  return (
    <Flex vertical gap={token.marginSM}>
      {clients.map((client) => (
        <McpClientCard key={client.id} client={client} {...cardActions} />
      ))}
    </Flex>
  );
};

export default McpClientsTab;
