import React from 'react';
import {
  Avatar,
  Badge,
  Card,
  Divider,
  Flex,
  Segmented,
  Switch,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { CloudOutlined, LaptopOutlined } from '@ant-design/icons';
import { VscMcp } from 'react-icons/vsc';
import type { McpStatus } from '../../../common/mcp';

const { Title, Text } = Typography;

interface McpHeaderProps {
  status: McpStatus;
  mode: 'local' | 'remote';
  busy: boolean;
  onModeChange: (mode: 'local' | 'remote') => void;
  onToggleEnabled: (enabled: boolean) => void;
}

const getStatus = (status: McpStatus) => {
  if (!status.enabled) return { badge: 'default', text: 'Off' } as const;
  if (status.mode === 'remote' && !status.relayConnected) {
    return { badge: 'warning', text: 'Connecting to relay' } as const;
  }
  return { badge: 'success', text: 'Online' } as const;
};

const McpHeader: React.FC<McpHeaderProps> = ({
  status,
  mode,
  busy,
  onModeChange,
  onToggleEnabled,
}) => {
  const { token } = theme.useToken();
  const { badge, text } = getStatus(status);
  const endpoint = status.remoteEndpoint ?? status.endpoint;

  return (
    <Card styles={{ body: { padding: token.paddingLG } }}>
      <Flex justify="space-between" align="center" gap={token.marginMD} wrap="wrap">
        <Flex align="center" gap={token.marginMD}>
          <Avatar
            shape="square"
            size={48}
            icon={<VscMcp size={26} />}
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
                AI Access
              </Title>
              <Badge status={badge} text={<Text type="secondary">{text}</Text>} />
            </Flex>
            <Text type="secondary">
              Let AI assistants like Claude or ChatGPT view and control your bots
            </Text>
          </div>
        </Flex>

        <Flex align="center" gap={token.marginSM}>
          <Tooltip title={status.enabled ? 'Turn AI access off to change where it runs' : undefined}>
            <Segmented
              value={mode}
              disabled={status.enabled}
              onChange={(value) => onModeChange(value as 'local' | 'remote')}
              options={[
                { value: 'local', label: 'This device', icon: <LaptopOutlined /> },
                { value: 'remote', label: 'Remote', icon: <CloudOutlined /> },
              ]}
            />
          </Tooltip>
          <Switch
            aria-label="Enable AI access"
            checked={status.enabled}
            loading={busy}
            onChange={onToggleEnabled}
          />
        </Flex>
      </Flex>

      <Divider style={{ margin: `${token.marginMD}px 0` }} />

      {status.enabled && endpoint ? (
        <Flex align="center" gap={token.marginSM} wrap="wrap">
          <Text type="secondary">Endpoint</Text>
          <Text code copyable={{ tooltips: ['Copy endpoint', 'Copied'] }}>
            {endpoint}
          </Text>
        </Flex>
      ) : (
        <Text type="secondary">
          {status.enabled
            ? 'Starting server…'
            : mode === 'local'
              ? 'Turn on to accept AI clients running on this computer.'
              : 'Turn on to accept AI clients from anywhere through the secure jnbot relay.'}
        </Text>
      )}
    </Card>
  );
};

export default McpHeader;
