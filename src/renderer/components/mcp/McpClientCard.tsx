import React from 'react';
import { Avatar, Button, Card, Dropdown, Flex, Tag, Tooltip, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined,
  DeleteOutlined,
  MoreOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { McpClientGrant } from '../../../common/mcp';
import { defaultPermissions, formatTime } from './types';
import { permissionRows } from './McpClientPermissionsContent';

const { Text } = Typography;

const policyTag = {
  allow: { color: 'success', label: 'Allowed' },
  ask: { color: 'warning', label: 'Asks you first' },
  deny: { color: 'default', label: 'Blocked' },
} as const;

interface McpClientCardProps {
  client: McpClientGrant;
  onOpenPermissions: (client: McpClientGrant) => void;
  onTestConnection: (client: McpClientGrant) => void;
  onRotateToken: (client: McpClientGrant) => void;
  onRemoveClient: (client: McpClientGrant) => void;
}

const McpClientCard: React.FC<McpClientCardProps> = ({
  client,
  onOpenPermissions,
  onTestConnection,
  onRotateToken,
  onRemoveClient,
}) => {
  const { token } = theme.useToken();
  const permissions = client.mcpPermissions ?? defaultPermissions;

  const menuItems: MenuProps['items'] = [
    {
      key: 'test',
      label: 'Test connection',
      icon: <ReloadOutlined />,
      onClick: () => onTestConnection(client),
    },
    {
      key: 'rotate',
      label: 'New access key',
      icon: <SafetyCertificateOutlined />,
      onClick: () => onRotateToken(client),
    },
    { type: 'divider' },
    {
      key: 'remove',
      label: 'Remove client',
      danger: true,
      icon: <DeleteOutlined />,
      onClick: () => onRemoveClient(client),
    },
  ];

  const profileCount = client.profileKeys.includes('*')
    ? 'All profiles'
    : `${client.profileKeys.length} profile${client.profileKeys.length === 1 ? '' : 's'}`;

  return (
    <Card size="small" styles={{ body: { padding: token.paddingMD } }}>
      <Flex justify="space-between" align="center" gap={token.marginMD} wrap="wrap">
        <Flex align="center" gap={token.marginMD} style={{ minWidth: 0 }}>
          <Avatar
            shape="square"
            size={40}
            icon={<ApiOutlined />}
            style={{
              background: token.colorFillSecondary,
              color: token.colorText,
              flexShrink: 0,
            }}
          />
          <Flex vertical gap={6} style={{ minWidth: 0 }}>
            <Flex align="center" gap={token.marginXS} wrap="wrap">
              <Text strong>{client.name}</Text>
              {client.revokedAt && <Tag color="error">Revoked</Tag>}
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {formatTime(client.lastActivityAt)} · {profileCount}
              </Text>
            </Flex>
            <Flex gap={4} wrap="wrap">
              {permissionRows.map(({ key, title, icon }) => {
                const policy = policyTag[permissions[key]];
                return (
                  <Tooltip key={key} title={`${title}: ${policy.label}`}>
                    <Tag
                      color={policy.color}
                      icon={icon}
                      variant="filled"
                      style={{
                        margin: 0,
                        textDecoration: permissions[key] === 'deny' ? 'line-through' : undefined,
                      }}
                    >
                      {title}
                    </Tag>
                  </Tooltip>
                );
              })}
            </Flex>
          </Flex>
        </Flex>

        <Flex align="center" gap={token.marginXS}>
          <Button icon={<SettingOutlined />} onClick={() => onOpenPermissions(client)}>
            Manage access
          </Button>
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <Button type="text" aria-label={`Options for ${client.name}`} icon={<MoreOutlined />} />
          </Dropdown>
        </Flex>
      </Flex>
    </Card>
  );
};

export default McpClientCard;
