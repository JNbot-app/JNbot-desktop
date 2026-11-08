import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Flex, Space, Tabs, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type {
  McpActivitySnapshot,
  McpApprovalRequest,
  McpClientGrant,
} from '../../common/mcp';
import useAppApi from '../hooks/useAppApi';
import { usePanelContext } from '../components/other/botSideBar/SidePanelContextProvider';
import McpHeader from '../components/mcp/McpHeader';
import McpClientsTab from '../components/mcp/McpClientsTab';
import McpApprovalQueue from '../components/mcp/McpApprovalQueue';
import type { ApprovalDecision } from '../components/mcp/McpApprovalItem';
import McpActivityTab from '../components/mcp/McpActivityTab';
import McpConnectModal from '../components/mcp/McpConnectModal';
import McpAccessKeyModal from '../components/mcp/McpAccessKeyModal';
import McpClientPermissionsContent from '../components/mcp/McpClientPermissionsContent';
import type { PairingResult } from '../components/mcp/types';

const emptySnapshot: McpActivitySnapshot = {
  status: {
    enabled: false,
    mode: 'off',
    connectedClients: 0,
  },
  clients: [],
  approvals: [],
  audit: [],
};

const AIControl: React.FC = () => {
  const { message, modal } = useAppApi();
  const { panel, setPanel } = usePanelContext();
  const { token } = theme.useToken();

  const [snapshot, setSnapshot] = useState<McpActivitySnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'local' | 'remote'>('remote');

  const [connectOpen, setConnectOpen] = useState(false);
  const [pairingResult, setPairingResult] = useState<PairingResult>();
  const [permissionsClient, setPermissionsClient] = useState<McpClientGrant>();

  const [activeTab, setActiveTab] = useState(() =>
    new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab') ===
    'activity'
      ? 'activity'
      : 'connections',
  );

  const refresh = useCallback(async () => {
    try {
      const next = await window.ipcRenderer.get<McpActivitySnapshot>('MCP_STATUS');
      setSnapshot(next);
      if (next.status.mode !== 'off') {
        setMode(next.status.mode);
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Could not load MCP status',
      );
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refresh();
    const dispose = window.ipcRenderer.on(
      'MCP_ACTIVITY',
      (next: McpActivitySnapshot) => setSnapshot(next),
    );
    return () => dispose?.();
  }, [refresh]);

  const pendingApprovals = useMemo(
    () => snapshot.approvals.filter(({ status }) => status === 'pending'),
    [snapshot.approvals],
  );

  const toggleEnabled = async (enabled: boolean) => {
    setBusy(true);
    try {
      if (enabled) {
        await window.ipcRenderer.get('MCP_ENABLE', { mode });
      } else {
        await window.ipcRenderer.get('MCP_DISABLE');
      }
      await refresh();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Could not update AI access',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConnectClient = async (name: string, profiles: string[]) => {
    setBusy(true);
    try {
      const result = await window.ipcRenderer.get<PairingResult>(
        'MCP_PAIR_CLIENT',
        {
          name,
          provider: 'custom',
          profileKeys: profiles,
        },
      );
      setPairingResult(result);
      setConnectOpen(false);
      message.success('AI client connected');
      await refresh();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Could not create access key',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateClient = useCallback(
    async (client: McpClientGrant, update: Partial<McpClientGrant>) => {
      try {
        await window.ipcRenderer.get('MCP_UPDATE_CLIENT', {
          clientId: client.id,
          update,
        });
        setPermissionsClient((current) =>
          current && current.id === client.id ? { ...current, ...update } : current,
        );
        await refresh();
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : 'Could not update client',
        );
      }
    },
    [message, refresh],
  );

  const handleTestConnection = useCallback(
    async (client: McpClientGrant) => {
      try {
        const result = await window.ipcRenderer.get<{
          ok: boolean;
          message: string;
        }>('MCP_TEST_CLIENT', { clientId: client.id });
        if (result.ok) {
          message.success(result.message);
        } else {
          message.error(result.message);
        }
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : 'Connection test failed',
        );
      }
    },
    [message],
  );

  const handleRotateToken = useCallback(
    async (client: McpClientGrant) => {
      try {
        const result = await window.ipcRenderer.get<{
          token: string;
          endpoint?: string;
          stdio: Record<string, unknown>;
        }>('MCP_ROTATE_TOKEN', { clientId: client.id });
        setPairingResult({ client, ...result });
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : 'Could not rotate access key',
        );
      }
    },
    [message],
  );

  const handleRemoveClient = useCallback(
    (client: McpClientGrant) => {
      modal.confirm({
        title: `Remove ${client.name}?`,
        content: 'Its access token will be invalidated immediately.',
        okText: 'Remove',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await window.ipcRenderer.get('MCP_REMOVE_CLIENT', {
              clientId: client.id,
            });
            if (permissionsClient?.id === client.id) {
              setPermissionsClient(undefined);
            }
            message.success('Client removed');
            await refresh();
          } catch (error) {
            message.error(
              error instanceof Error ? error.message : 'Could not remove client',
            );
          }
        },
      });
    },
    [message, modal, permissionsClient?.id, refresh],
  );

  const handleDecideApproval = async (
    approval: McpApprovalRequest,
    { approved, remember, profileKeys }: ApprovalDecision,
  ) => {
    try {
      await window.ipcRenderer.get('MCP_DECIDE_APPROVAL', {
        approvalId: approval.id,
        approved,
        rememberFor15Minutes: remember,
        profileKeys,
      });
      if (approved) {
        message.success('Request approved');
      } else {
        message.info('Request denied');
      }
      await refresh();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Could not decide approval',
      );
    }
  };

  const handleClearAudit = () => {
    modal.confirm({
      title: 'Clear AI Activity History?',
      content: 'All past logged events will be cleared.',
      okText: 'Clear',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await window.ipcRenderer.get('MCP_CLEAR_AUDIT');
          message.success('History cleared');
          await refresh();
        } catch (error) {
          message.error(
            error instanceof Error ? error.message : 'Could not clear history',
          );
        }
      },
    });
  };

  const handleCopy = async (value: string, label = 'Copied') => {
    await navigator.clipboard.writeText(value);
    message.success(label);
  };

  const handleOpenPermissions = (client: McpClientGrant) => {
    setPermissionsClient(client);
    setPanel({
      active: true,
      tab: 'mcp-client-access',
      data: {
        label: `${client.name} access`,
        content: (
          <McpClientPermissionsContent
            client={client}
            onUpdateClient={handleUpdateClient}
          />
        ),
      },
    });
  };

  // Sync side panel if open
  useEffect(() => {
    if (panel.tab !== 'mcp-client-access') return;
    if (!permissionsClient) {
      if (panel.active) {
        setPanel((current) => ({ ...current, active: false }));
      }
      return;
    }
    const label = `${permissionsClient.name} access`;
    setPanel((current) => ({
      ...current,
      data: {
        label,
        content: (
          <McpClientPermissionsContent
            client={permissionsClient}
            onUpdateClient={handleUpdateClient}
          />
        ),
      },
    }));
  }, [handleUpdateClient, panel.active, panel.tab, permissionsClient, setPanel]);

  const connectionEndpoint =
    snapshot.status.remoteEndpoint ?? snapshot.status.endpoint;

  return (
    <div style={{ width: '100%' }}>
      <Flex vertical gap={token.marginLG}>
        {/* Header */}
        <McpHeader
          status={snapshot.status}
          mode={mode}
          busy={busy || loading}
          onModeChange={setMode}
          onToggleEnabled={toggleEnabled}
        />

        <McpApprovalQueue
          approvals={pendingApprovals}
          onDecide={handleDecideApproval}
        />

        <Card styles={{ body: { paddingTop: token.paddingXS } }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            tabBarExtraContent={
              activeTab === 'connections' && snapshot.clients.length > 0 ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setConnectOpen(true)}
                >
                  Connect client
                </Button>
              ) : null
            }
            items={[
              {
                key: 'connections',
                label: (
                  <Space size={6}>
                    Clients
                    <Badge
                      count={snapshot.clients.length}
                      color={token.colorFillSecondary}
                      style={{ color: token.colorTextSecondary }}
                    />
                  </Space>
                ),
                children: (
                  <McpClientsTab
                    clients={snapshot.clients}
                    onOpenConnectModal={() => setConnectOpen(true)}
                    onOpenPermissions={handleOpenPermissions}
                    onTestConnection={handleTestConnection}
                    onRotateToken={handleRotateToken}
                    onRemoveClient={handleRemoveClient}
                  />
                ),
              },
              {
                key: 'activity',
                label: 'Activity',
                children: (
                  <McpActivityTab
                    snapshot={snapshot}
                    onRefresh={refresh}
                    onClearAudit={handleClearAudit}
                  />
                ),
              },
            ]}
          />
        </Card>
      </Flex>

      {/* Connect client modal */}
      <McpConnectModal
        open={connectOpen}
        busy={busy}
        onCancel={() => setConnectOpen(false)}
        onConnect={handleConnectClient}
      />

      {/* Access key display modal */}
      <McpAccessKeyModal
        pairingResult={pairingResult}
        connectionEndpoint={connectionEndpoint}
        onClose={() => setPairingResult(undefined)}
        onCopy={handleCopy}
      />
    </div>
  );
};

export default AIControl;
