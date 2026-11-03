import React from 'react';
import { Avatar, Card, Divider, Flex, Segmented, Typography, theme } from 'antd';
import {
  ApiOutlined,
  CodeOutlined,
  EyeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { McpClientGrant } from '../../../common/mcp';
import ProfileSelector from '../ProfileSelector';
import { defaultPermissions, type PermissionRow } from './types';

const { Text } = Typography;

export const permissionRows: PermissionRow[] = [
  {
    key: 'observe',
    title: 'View bot data',
    description: 'Status, world, inventory and run history',
    icon: <EyeOutlined />,
  },
  {
    key: 'control',
    title: 'Control bots',
    description: 'Move, chat, interact and manage inventory',
    icon: <ThunderboltOutlined />,
  },
  {
    key: 'code',
    title: 'Run code',
    description: 'Execute reviewed JavaScript on an active bot',
    icon: <CodeOutlined />,
  },
  {
    key: 'plugins',
    title: 'Manage plugins',
    description: 'Install, configure, start and stop plugins',
    icon: <ApiOutlined />,
  },
];

const policyOptions = [
  { value: 'deny', label: 'Blocked' },
  { value: 'ask', label: 'Ask me' },
  { value: 'allow', label: 'Allowed' },
];

interface McpClientPermissionsContentProps {
  client: McpClientGrant;
  onUpdateClient: (client: McpClientGrant, update: Partial<McpClientGrant>) => void;
}

const McpClientPermissionsContent: React.FC<McpClientPermissionsContentProps> = ({
  client,
  onUpdateClient,
}) => {
  const { token } = theme.useToken();
  const permissions = client.mcpPermissions ?? defaultPermissions;

  return (
    <Flex vertical gap={token.marginMD}>
      <Flex vertical gap={token.marginXS}>
        <div>
          <Text strong style={{ display: 'block' }}>
            Profiles
          </Text>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Which profiles this client can see and use
          </Text>
        </div>
        <ProfileSelector
          style={{ width: '100%' }}
          value={client.profileKeys}
          includeAll
          onChange={(profileKeys) => onUpdateClient(client, { profileKeys })}
          placeholder="Choose profiles"
        />
      </Flex>

      <Divider style={{ margin: 0 }} />

      <Flex vertical gap={token.marginXS}>
        <div>
          <Text strong style={{ display: 'block' }}>
            Permissions
          </Text>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            &quot;Ask me&quot; sends each request to you for approval first
          </Text>
        </div>

        {permissionRows.map((item) => (
          <Card key={item.key} size="small">
            <Flex vertical gap={token.marginSM}>
              <Flex align="center" gap={token.marginSM}>
                <Avatar
                  shape="square"
                  size={32}
                  icon={item.icon}
                  style={{
                    background: token.colorFillSecondary,
                    color: token.colorTextSecondary,
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <Text strong style={{ display: 'block' }}>
                    {item.title}
                  </Text>
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {item.description}
                  </Text>
                </div>
              </Flex>
              <Segmented
                block
                size="small"
                aria-label={`${item.title} permission`}
                value={permissions[item.key]}
                options={
                  item.key === 'observe'
                    ? policyOptions.filter(({ value }) => value !== 'ask')
                    : policyOptions
                }
                onChange={(value) =>
                  onUpdateClient(client, {
                    mcpPermissions: { ...permissions, [item.key]: value },
                  })
                }
              />
            </Flex>
          </Card>
        ))}
      </Flex>
    </Flex>
  );
};

export default McpClientPermissionsContent;
