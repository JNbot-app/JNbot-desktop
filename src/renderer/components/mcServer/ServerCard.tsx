import React, { memo, type KeyboardEvent, type MouseEvent } from 'react';
import {
  Button,
  Card,
  Dropdown,
  Flex,
  Progress,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined,
  CloudServerOutlined,
  CopyOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  GlobalOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  RotateRightOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { MinecraftServerSummary } from '../../../common/minecraftServers';
import type { ServerActions } from './types';

const { Text } = Typography;

interface ServerCardProps extends ServerActions {
  server: MinecraftServerSummary;
  busy: boolean;
}

const stateConfig: Record<
  MinecraftServerSummary['state'],
  {
    tagColor: string;
    label: string;
  }
> = {
  installing: { tagColor: 'processing', label: 'Installing' },
  stopped: { tagColor: 'default', label: 'Stopped' },
  starting: { tagColor: 'processing', label: 'Starting' },
  online: { tagColor: 'success', label: 'Online' },
  stopping: { tagColor: 'warning', label: 'Stopping' },
  offline: { tagColor: 'default', label: 'Offline' },
  error: { tagColor: 'error', label: 'Error' },
};

const sourceInfo = (source: MinecraftServerSummary['source']) => {
  switch (source) {
    case 'dedicated':
      return { label: 'Fabric Server', icon: <CloudServerOutlined /> };
    case 'client-lan':
      return { label: 'JNbot Client', icon: <ApiOutlined /> };
    case 'manual-lan':
    default:
      return { label: 'LAN World', icon: <GlobalOutlined /> };
  }
};

const ServerCard: React.FC<ServerCardProps> = memo(
  ({
    server,
    busy,
    onStart,
    onStop,
    onCopy,
    onInvite,
    onOpen,
    onRemove,
  }) => {
    const { token } = theme.useToken();
    const isOnline = server.state === 'online';
    const config = stateConfig[server.state] || stateConfig.offline;
    const source = sourceInfo(server.source);

    const menuItems: MenuProps['items'] = [
      ...(server.localAddress
        ? [
            {
              key: 'copy-address',
              label: 'Copy Address',
              icon: <CopyOutlined />,
              onClick: () => onCopy(server.localAddress!, 'Address'),
            },
          ]
        : []),
      ...(server.role === 'host'
        ? [
            {
              key: 'copy-invite',
              label: 'Copy Invite',
              icon: <CopyOutlined />,
              onClick: () => onInvite(server),
            },
            {
              key: 'rotate',
              label: 'Rotate Invite Code',
              icon: <RotateRightOutlined />,
              onClick: () => onInvite(server, true),
            },
          ]
        : []),
      { type: 'divider' },
      {
        key: 'remove',
        label: 'Remove Server',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => onRemove(server),
      },
    ];

    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen(server);
      }
    };

    const stopPropagation = (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
    };

    const progressPercent = server.progress?.total
      ? Math.min(
          100,
          Math.round(((server.progress.current ?? 0) / server.progress.total) * 100),
        )
      : server.progress
        ? 50
        : 0;

    return (
      <Card
        hoverable
        role="button"
        tabIndex={0}
        aria-label={`Server: ${server.name}`}
        onClick={() => onOpen(server)}
        onKeyDown={handleKeyDown}
        style={{
          height: '100%',
          borderRadius: token.borderRadiusLG,
          borderColor: isOnline ? token.colorPrimaryBorder : token.colorBorderSecondary,
          backgroundColor: token.colorBgContainer,
          transition: 'all 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
        }}
        styles={{
          body: {
            padding: token.paddingMD,
            display: 'flex',
            flexDirection: 'column',
            gap: token.marginSM,
            flex: 1,
          },
        }}
      >
        {/* Header */}
        <Flex justify="space-between" align="flex-start" gap={token.marginSM}>
          <Flex align="center" gap={token.marginSM} style={{ minWidth: 0 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: token.borderRadiusLG,
                backgroundColor: isOnline ? token.colorPrimaryBg : token.colorFillAlter,
                color: isOnline ? token.colorPrimary : token.colorTextSecondary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
                border: `1px solid ${isOnline ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
              }}
            >
              {source.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <Text
                strong
                ellipsis={{ tooltip: server.name }}
                style={{
                  fontSize: token.fontSizeLG - 1,
                  lineHeight: '22px',
                  display: 'block',
                }}
              >
                {server.name}
              </Text>
              <Text
                type="secondary"
                style={{ fontSize: token.fontSizeSM - 1, display: 'block' }}
              >
                {source.label} · v{server.version}
              </Text>
            </div>
          </Flex>
          <Tag
            color={config.tagColor}
            style={{
              margin: 0,
              borderRadius: token.borderRadiusSM,
              padding: '0 8px',
              fontSize: token.fontSizeSM - 1,
            }}
          >
            {config.label}
          </Tag>
        </Flex>

        {/* Status / Metadata Chips */}
        <Flex wrap gap={token.marginXS} style={{ marginTop: token.marginXXS }}>
          <Tag
            icon={<TeamOutlined />}
            style={{
              borderRadius: token.borderRadiusSM,
              margin: 0,
              backgroundColor: token.colorFillAlter,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            {server.peerCount} {server.peerCount === 1 ? 'Player' : 'Players'}
          </Tag>

          {server.localAddress && isOnline && (
            <Tooltip title="Click to copy local address">
              <Tag
                icon={<CopyOutlined />}
                onClick={(e) => {
                  stopPropagation(e);
                  onCopy(server.localAddress!, 'Address');
                }}
                style={{
                  borderRadius: token.borderRadiusSM,
                  margin: 0,
                  cursor: 'pointer',
                  backgroundColor: token.colorFillAlter,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                {server.localAddress}
              </Tag>
            </Tooltip>
          )}
        </Flex>

        {/* Progress Bar if active task */}
        {server.progress && (
          <div style={{ marginTop: token.marginXXS }}>
            <Flex justify="space-between" style={{ marginBottom: 2 }}>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM - 1 }}>
                {server.progress.label || 'Processing…'}
              </Text>
              {server.progress.total && (
                <Text type="secondary" style={{ fontSize: token.fontSizeSM - 1 }}>
                  {progressPercent}%
                </Text>
              )}
            </Flex>
            <Progress
              percent={progressPercent}
              status="active"
              showInfo={false}
              size="small"
            />
          </div>
        )}

        {/* Footer Actions */}
        <Flex
          justify="space-between"
          align="center"
          style={{ marginTop: 'auto', paddingTop: token.marginSM }}
          onClick={stopPropagation}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Space size="small">
            {server.role === 'host' ? (
              isOnline ? (
                <Button
                  danger
                  size="small"
                  icon={<PoweroffOutlined />}
                  loading={busy}
                  onClick={() => onStop(server)}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="small"
                  icon={<PlayCircleOutlined />}
                  loading={busy}
                  disabled={
                    server.state === 'installing' || server.state === 'starting'
                  }
                  onClick={() => onStart(server)}
                >
                  Start
                </Button>
              )
            ) : (
              server.localAddress && (
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => onCopy(server.localAddress!, 'Address')}
                >
                  Copy Address
                </Button>
              )
            )}

            <Button
              size="small"
              onClick={() => onOpen(server)}
            >
              Details
            </Button>
          </Space>

          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button
              type="text"
              size="small"
              aria-label={`More actions for ${server.name}`}
              icon={<EllipsisOutlined />}
            />
          </Dropdown>
        </Flex>
      </Card>
    );
  },
);

export default ServerCard;
