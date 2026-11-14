import React from 'react';
import { Button, Card, Dropdown, Flex, Tag, Tooltip, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  DeleteOutlined,
  MoreOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { McpClientGrant } from '../../../common/mcp';
import { defaultPermissions, formatTime } from './types';
import { permissionRows } from './McpClientPermissionsContent';
import { getClientBrand } from './clientBrand';

const { Text } = Typography;

const policyStyle = {
  allow: { label: 'Allowed', color: 'colorSuccess' },
  ask: { label: 'Asks you first', color: 'colorWarning' },
  deny: { label: 'Blocked', color: 'colorTextQuaternary' },
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
  const brand = getClientBrand(client.name);

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
          <Flex
            align="center"
            justify="center"
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              fontSize: 22,
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillQuaternary,
              color: brand.color ?? token.colorText,
            }}
          >
            {brand.icon}
          </Flex>
          <Flex vertical gap={4} style={{ minWidth: 0 }}>
            <Flex align="center" gap={token.marginXS} wrap="wrap">
              <Text strong>{client.name}</Text>
              {client.revokedAt && <Tag color="error">Revoked</Tag>}
            </Flex>
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {formatTime(client.lastActivityAt)} · {profileCount}
            </Text>
          </Flex>
        </Flex>

        <Flex align="center" gap={token.marginMD}>
          <Flex align="center" gap={token.marginXS}>
            {permissionRows.map(({ key, title, icon }) => {
              const policy = policyStyle[permissions[key]];
              return (
                <Tooltip key={key} title={`${title}: ${policy.label}`}>
                  <Flex
                    align="center"
                    justify="center"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: token.borderRadius,
                      color: token[policy.color],
                      background: token.colorFillQuaternary,
                      opacity: permissions[key] === 'deny' ? 0.6 : 1,
                    }}
                  >
                    {icon}
                  </Flex>
                </Tooltip>
              );
            })}
          </Flex>
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
