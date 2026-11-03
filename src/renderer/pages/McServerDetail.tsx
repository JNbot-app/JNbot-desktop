import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Descriptions,
  Dropdown,
  Flex,
  Result,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  ApiOutlined,
  ArrowLeftOutlined,
  CloudServerOutlined,
  CopyOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  GlobalOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  RotateRightOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  MinecraftServerDetail,
  MinecraftServerSummary,
} from '../../common/minecraftServers';
import ServerConsole from '../components/mcServer/ServerConsole';
import ServerPlugins from '../components/mcServer/ServerPlugins';
import useAppApi from '../hooks/useAppApi';

const { Title, Text } = Typography;

const McServerDetailPage: React.FC = () => {
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message, modal } = useAppApi();
  const { token } = theme.useToken();

  const [server, setServer] = useState<MinecraftServerDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    setError(undefined);
    try {
      setServer(
        await window.ipcRenderer.get('MC_SERVER_GET', { id: serverId }),
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
    const dispose = window.ipcRenderer.on(
      'MC_SERVERS_UPDATE',
      (servers: MinecraftServerSummary[]) => {
        const summary = servers.find((entry) => entry.id === serverId);
        if (!summary) {
          setError('Minecraft server not found');
          setServer(undefined);
          return;
        }
        setServer((current) =>
          current
            ? {
                ...current,
                ...summary,
              }
            : ({
                ...summary,
                capabilities: {
                  console:
                    summary.role === 'host' && summary.source === 'dedicated',
                  plugins:
                    summary.role === 'host' && summary.source === 'dedicated',
                  api: summary.apiState !== 'unsupported',
                },
              } satisfies MinecraftServerDetail),
        );
      },
    );
    return () => dispose?.();
  }, [load, serverId]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
    } catch (reason) {
      message.error(errorText(reason));
      throw reason;
    } finally {
      setBusy(undefined);
    }
  };

  const start = async () => {
    if (!server) return;
    const servers = await window.ipcRenderer.get('MC_SERVERS_LIST');
    const active = servers.find(
      (entry: MinecraftServerSummary) =>
        entry.role === 'host' &&
        entry.id !== server.id &&
        entry.state === 'online',
    );
    if (active) {
      modal.confirm({
        title: `Switch from ${active.name} to ${server.name}?`,
        content: 'Only one local Minecraft world can be hosted at a time.',
        okText: 'Switch profile',
        onOk: () =>
          run('start', async () => {
            await window.ipcRenderer.get('MC_SERVER_STOP', { id: active.id });
            await window.ipcRenderer.get('MC_SERVER_START', {
              id: server.id,
            });
          }),
      });
      return;
    }
    await run('start', () =>
      window.ipcRenderer.get('MC_SERVER_START', { id: server.id }),
    );
  };

  const restart = async () => {
    if (!server) return;
    await run('restart', () =>
      window.ipcRenderer.get('MC_SERVER_RESTART', { id: server.id }),
    );
  };

  const copyInvite = async (rotate = false) => {
    if (!server) return;
    try {
      const invite = rotate
        ? await window.ipcRenderer.get('MC_SERVER_ROTATE_INVITE', {
            id: server.id,
          })
        : await window.ipcRenderer.get('MC_SERVER_INVITE', { id: server.id });
      await navigator.clipboard.writeText(invite);
      message.success(rotate ? 'New invite generated and copied' : 'Invite copied');
    } catch (reason) {
      message.error(errorText(reason));
    }
  };

  const copyAddress = async () => {
    if (!server?.localAddress) return;
    try {
      await navigator.clipboard.writeText(server.localAddress);
      message.success('Address copied');
    } catch (reason) {
      message.error(errorText(reason));
    }
  };

  const remove = () => {
    if (!server) return;
    const deleteFiles = server.role === 'host' && server.source === 'dedicated';
    modal.confirm({
      title: `Remove ${server.name}?`,
      content: deleteFiles
        ? 'The managed server files will move to Trash.'
        : 'This removes the server from JNbot.',
      okText: deleteFiles ? 'Move to Trash' : 'Remove',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.ipcRenderer.get('MC_SERVER_REMOVE', {
          id: server.id,
          deleteFiles,
        });
        navigate('/mc-server', { replace: true });
      },
    });
  };

  const requestedTab = searchParams.get('tab') ?? 'overview';
  const tab = useMemo(() => {
    if (!server) return 'overview';
    const valid = [
      'overview',
      'console',
      ...(server.capabilities.plugins ? ['plugins'] : []),
    ];
    return valid.includes(requestedTab) ? requestedTab : 'overview';
  }, [requestedTab, server]);

  const switchTab = (nextTab: string) => {
    const params = new URLSearchParams(searchParams);
    if (nextTab === 'overview') params.delete('tab');
    else params.set('tab', nextTab);
    setSearchParams(params, { replace: true });
  };

  if (window.web) {
    return (
      <Result
        status="info"
        title="Minecraft hosting is available in the JNbot desktop app"
      />
    );
  }

  if (loading) {
    return (
      <Flex vertical gap={token.marginMD} style={{ padding: token.paddingMD }}>
        <Skeleton active avatar title paragraph={{ rows: 8 }} />
      </Flex>
    );
  }

  if (error || !server) {
    return (
      <Result
        status="404"
        title="Minecraft server not found"
        subTitle={error}
        extra={
          <Button type="primary" onClick={() => navigate('/mc-server')}>
            Back to servers
          </Button>
        }
      />
    );
  }

  const online = server.state === 'online';
  const dedicated = server.role === 'host' && server.source === 'dedicated';

  const actionItems: MenuProps['items'] = [
    ...(server.localAddress
      ? [
          {
            key: 'copy-address',
            label: 'Copy Address',
            icon: <CopyOutlined />,
            onClick: () => void copyAddress(),
          },
        ]
      : []),
    ...(server.role === 'host'
      ? [
          {
            key: 'copy-invite',
            label: 'Copy Invite',
            icon: <CopyOutlined />,
            onClick: () => void copyInvite(),
          },
          {
            key: 'rotate-invite',
            label: 'Rotate Invite Code',
            icon: <RotateRightOutlined />,
            onClick: () => void copyInvite(true),
          },
        ]
      : []),
    { type: 'divider' },
    {
      key: 'remove',
      label: 'Remove Server',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: remove,
    },
  ];

  const source = sourceConfig(server.source);
  const state = stateConfig[server.state] || stateConfig.offline;

  const tabs = [
    {
      key: 'overview',
      label: 'Overview',
      children: (
        <Card
          style={{
            borderRadius: token.borderRadiusLG,
            borderColor: token.colorBorderSecondary,
            backgroundColor: token.colorBgContainer,
          }}
        >
          <Descriptions
            title="Server Details"
            column={{ xs: 1, sm: 2, lg: 3 }}
            items={[
              {
                key: 'version',
                label: 'Minecraft Version',
                children: `v${server.version}`,
              },
              {
                key: 'source',
                label: 'Server Type',
                children: sourceLabel(server),
              },
              {
                key: 'players',
                label: 'Connected Players',
                children: `${server.peerCount} connected`,
              },
              {
                key: 'address',
                label: 'Local Address',
                children: server.localAddress ? (
                  <Flex align="center" gap={token.marginXXS}>
                    <span>{server.localAddress}</span>
                    <Tooltip title="Copy address">
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => void copyAddress()}
                      />
                    </Tooltip>
                  </Flex>
                ) : (
                  <Text type="secondary">Available when online</Text>
                ),
              },
              {
                key: 'plugins',
                label: 'Server Plugins',
                children: dedicated ? `${server.pluginCount} installed` : 'Unavailable',
              },
              {
                key: 'api',
                label: 'JNbot Server API',
                children: (
                  <Space size="small">
                    <Badge status={apiBadge(server.apiState)} />
                    <span>{apiLabel(server.apiState)}</span>
                    {server.apiVersion && <Tag>{server.apiVersion}</Tag>}
                  </Space>
                ),
              },
              ...(server.memoryMB
                ? [
                    {
                      key: 'memory',
                      label: 'Allocated Memory',
                      children: `${server.memoryMB} MB`,
                    },
                  ]
                : []),
              ...(server.onlineMode !== undefined
                ? [
                    {
                      key: 'onlineMode',
                      label: 'Authentication',
                      children: server.onlineMode ? 'Microsoft Auth' : 'Offline Mode',
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      ),
    },
    {
      key: 'console',
      label: dedicated ? 'Console' : 'Connection log',
      children: (
        <div style={{ height: `calc(100vh - 280px)` }}>
          <ServerConsole server={server} />
        </div>
      ),
    },
    ...(server.capabilities.plugins
      ? [
          {
            key: 'plugins',
            label: `Plugins (${server.pluginCount})`,
            children: (
              <ServerPlugins
                server={server}
                restarting={busy === 'restart'}
                onRestart={restart}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <Flex vertical gap={token.marginLG}>
      {/* Top Navigation & Server Header */}
      <Flex vertical gap={token.marginMD}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/mc-server')}
          style={{ width: 'fit-content', padding: 0 }}
        >
          Back to servers
        </Button>

        <Flex justify="space-between" align="center" wrap="wrap" gap={token.marginMD}>
          <Flex align="center" gap={token.marginMD}>
            <Avatar
              shape="square"
              size={52}
              style={{
                backgroundColor: online ? token.colorPrimaryBg : token.colorFillAlter,
                color: online ? token.colorPrimary : token.colorTextSecondary,
                border: `1px solid ${online ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: token.borderRadiusLG,
              }}
              icon={source.icon}
            />
            <div>
              <Flex align="center" gap={token.marginXS}>
                <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
                  {server.name}
                </Title>
                <Tag
                  color={state.tagColor}
                  style={{
                    borderRadius: token.borderRadiusSM,
                    marginLeft: token.marginXXS,
                  }}
                >
                  {state.label}
                </Tag>
                {server.restartRequired && (
                  <Tag
                    color="warning"
                    icon={<ReloadOutlined />}
                    style={{ borderRadius: token.borderRadiusSM }}
                  >
                    Restart required
                  </Tag>
                )}
              </Flex>
              <Space size="small" style={{ marginTop: 2 }}>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {source.label} · v{server.version}
                </Text>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  ·
                </Text>
                <Tag
                  icon={<TeamOutlined />}
                  style={{
                    margin: 0,
                    borderRadius: token.borderRadiusSM,
                    backgroundColor: token.colorFillAlter,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  {server.peerCount} {server.peerCount === 1 ? 'player' : 'players'}
                </Tag>
              </Space>
            </div>
          </Flex>

          <Space wrap size="small">
            {server.restartRequired && (
              <Button
                icon={<ReloadOutlined />}
                loading={busy === 'restart'}
                onClick={() => void restart()}
              >
                Restart Server
              </Button>
            )}

            {server.role === 'host' &&
              (online ? (
                <Button
                  danger
                  icon={<PoweroffOutlined />}
                  loading={busy === 'stop'}
                  onClick={() =>
                    void run('stop', () =>
                      window.ipcRenderer.get('MC_SERVER_STOP', {
                        id: server.id,
                      }),
                    )
                  }
                >
                  Stop Server
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={busy === 'start'}
                  disabled={
                    server.state === 'starting' || server.state === 'installing'
                  }
                  onClick={() => void start()}
                >
                  Start Server
                </Button>
              ))}

            <Dropdown menu={{ items: actionItems }} trigger={['click']}>
              <Button
                aria-label={`More actions for ${server.name}`}
                icon={<EllipsisOutlined />}
              />
            </Dropdown>
          </Space>
        </Flex>
      </Flex>

      {/* Tabs */}
      <Tabs
        activeKey={tab}
        onChange={(next) => switchTab(next)}
        items={tabs}
      />
    </Flex>
  );
};

const stateConfig: Record<
  MinecraftServerSummary['state'],
  {
    status: 'default' | 'processing' | 'success' | 'warning' | 'error';
    tagColor: string;
    label: string;
  }
> = {
  installing: { status: 'processing', tagColor: 'processing', label: 'Installing' },
  stopped: { status: 'default', tagColor: 'default', label: 'Stopped' },
  starting: { status: 'processing', tagColor: 'processing', label: 'Starting' },
  online: { status: 'success', tagColor: 'success', label: 'Online' },
  stopping: { status: 'warning', tagColor: 'warning', label: 'Stopping' },
  offline: { status: 'default', tagColor: 'default', label: 'Offline' },
  error: { status: 'error', tagColor: 'error', label: 'Error' },
};

const sourceConfig = (source: MinecraftServerSummary['source']) => {
  switch (source) {
    case 'dedicated':
      return {
        label: 'Fabric Server',
        icon: <CloudServerOutlined style={{ fontSize: 26 }} />,
      };
    case 'client-lan':
      return {
        label: 'JNbot Client',
        icon: <ApiOutlined style={{ fontSize: 26 }} />,
      };
    case 'manual-lan':
    default:
      return {
        label: 'LAN World',
        icon: <GlobalOutlined style={{ fontSize: 26 }} />,
      };
  }
};

const apiBadge = (
  state: MinecraftServerSummary['apiState'],
): 'default' | 'processing' | 'success' | 'error' =>
  state === 'online'
    ? 'success'
    : state === 'connecting'
      ? 'processing'
      : state === 'error'
        ? 'error'
        : 'default';

const apiLabel = (state: MinecraftServerSummary['apiState']) =>
  ({
    unsupported: 'Unsupported for this version',
    offline: 'Offline',
    connecting: 'Connecting',
    online: 'Connected',
    error: 'Unavailable',
  })[state];

const sourceLabel = (server: MinecraftServerSummary) =>
  server.source === 'dedicated'
    ? server.role === 'host'
      ? 'Managed Fabric server'
      : 'Private managed server'
    : server.source === 'client-lan'
      ? 'JNbot Client world'
      : 'Shared LAN world';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default McServerDetailPage;
