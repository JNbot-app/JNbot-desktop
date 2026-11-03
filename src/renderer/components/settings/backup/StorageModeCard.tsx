import React, { useEffect, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Flex,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  CheckCircleFilled,
  DesktopOutlined,
  CloudSyncOutlined,
  SwapOutlined,
  SyncOutlined,
  UserOutlined,
  WarningOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import useAppApi from 'renderer/hooks/useAppApi';
import { withAlpha } from 'renderer/components/intro/introUtils';

const { Text, Title } = Typography;

type Status = {
  mode: 'local' | 'dropbox';
  connected: boolean;
  account?: { id: string; email?: string; name?: string };
  accounts: { id: string; email?: string; name?: string }[];
  writes?: { saving: boolean; lastSavedAt?: number; lastError?: string };
  startupError?: string;
};

const StorageModeCard: React.FC = () => {
  const { token } = theme.useToken();
  const { modal, message } = useAppApi();

  const [status, setStatus] = useState<Status>();
  const [verifier, setVerifier] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    if (window.web) return;
    setStatus(await window.ipcRenderer.invoke<Status>('storage:status'));
  };

  useEffect(() => {
    if (window.web) return;
    void refresh().catch((cause) => setError(String(cause)));
    return window.ipcRenderer.on(
      'storage:write-status',
      (writes: Status['writes']) => {
        setStatus((previous) => previous && { ...previous, writes });
      },
    );
  }, []);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const beginLogin = () =>
    perform(async () => {
      const login = await window.ipcRenderer.invoke<{
        url: string;
        verifier: string;
      }>('storage:begin-login');
      setVerifier(login.verifier);
      await window.ipcRenderer.invoke('storage:open-login', login.url);
    });

  const completeLogin = () =>
    perform(async () => {
      await window.ipcRenderer.invoke(
        'storage:complete-login',
        code.trim(),
        verifier,
      );
      setVerifier('');
      setCode('');
    });

  const select = (mode: Status['mode'], accountId?: string) => {
    modal.confirm({
      title: `Switch to ${mode === 'local' ? 'Device' : 'Dropbox'} storage?`,
      content:
        'The two stores are separate. Running bots and scripts will stop while JNbot restarts.',
      okText: 'Switch and restart',
      onOk: () =>
        perform(async () => {
          const result = await window.ipcRenderer.invoke<{
            save?: { lastError?: string };
          }>('storage:select', mode, accountId);
          if (result?.save?.lastError) setError(result.save.lastError);
        }),
    });
  };

  const saveNow = () =>
    perform(async () => {
      const save = await window.ipcRenderer.invoke<{ lastError?: string }>(
        'storage:flush',
      );
      if (save?.lastError) throw new Error(save.lastError);
    });

  const transfer = () => {
    const toDropbox = status?.mode === 'local';
    modal.confirm({
      title: toDropbox ? 'Copy device data to Dropbox?' : 'Copy Dropbox data to this device?',
      content: `This replaces the data in ${toDropbox ? 'your Dropbox account' : 'Device Storage'} with the data you are currently using. ${toDropbox ? 'Dropbox' : 'Device'} files that are not in your current data are removed.`,
      okText: 'Copy',
      onOk: () =>
        perform(async () => {
          const result = await window.ipcRenderer.invoke<{ written: number; removed: number }>('storage:transfer', status?.account?.id);
          message.success(`Copied ${result.written} file(s), removed ${result.removed}.`);
        }),
    });
  };

  const disconnect = (accountId: string) => {
    modal.confirm({
      title: 'Disconnect Dropbox account?',
      content:
        'Your Dropbox data will remain safe in your Dropbox account. JNbot will unlink the connection.',
      okText: 'Disconnect',
      okType: 'danger',
      onOk: () =>
        perform(() => window.ipcRenderer.invoke('storage:disconnect', accountId)),
    });
  };

  if (window.web) {
    return (
      <Card
        variant="borderless"
        style={{
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Text type="secondary">
          Storage mode is managed by the host server.
        </Text>
      </Card>
    );
  }

  const isLocalActive = status?.mode === 'local';
  const isDropboxActive = status?.mode === 'dropbox';
  const displayError =
    error || status?.startupError || status?.writes?.lastError;

  return (
    <Card
      variant="borderless"
      style={{
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
      styles={{
        body: {
          padding: token.paddingLG,
          display: 'flex',
          flexDirection: 'column',
          gap: token.marginMD,
        },
      }}
    >
      <div>
        <Title level={5} style={{ margin: 0 }}>
          Active Storage Location
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Choose where your live profiles, accounts, and plugins are stored.
        </Text>
      </div>

      <Flex gap={token.marginMD} wrap="wrap">
        {/* Local Device Option Card */}
        <div
          onClick={!isLocalActive && !busy ? () => select('local') : undefined}
          style={{
            flex: '1 1 260px',
            minWidth: 240,
            padding: `${token.padding}px ${token.paddingLG}px`,
            borderRadius: token.borderRadiusLG,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            cursor: !isLocalActive ? 'pointer' : 'default',
            transition: 'all 0.2s ease',
          }}
        >
          <Flex
            align="center"
            justify="space-between"
            style={{ marginBottom: 8 }}
          >
            <Space align="center" size={token.marginSM}>
              <Avatar
                size={36}
                shape="square"
                icon={<DesktopOutlined />}
                style={{
                  background: token.colorFillSecondary,
                  color: token.colorText,
                }}
              />
              <div>
                <Text strong style={{ display: 'block', fontSize: 14 }}>
                  Device Storage
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Stored locally on this computer
                </Text>
              </div>
            </Space>
            {isLocalActive ? (
              <Tag
                color="success"
                icon={<CheckCircleFilled />}
                style={{ margin: 0 }}
              >
                ACTIVE
              </Tag>
            ) : (
              <Button
                size="small"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  select('local');
                }}
              >
                Use Device
              </Button>
            )}
          </Flex>
        </div>

        {/* Dropbox Option Card */}
        <div
          onClick={
            !isDropboxActive && status?.connected && !busy
              ? () => select('dropbox')
              : undefined
          }
          style={{
            flex: '1 1 260px',
            minWidth: 240,
            padding: `${token.padding}px ${token.paddingLG}px`,
            borderRadius: token.borderRadiusLG,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            cursor:
              !isDropboxActive && status?.connected ? 'pointer' : 'default',
            transition: 'all 0.2s ease',
          }}
        >
          <Flex align="center" justify="space-between" style={{ marginBottom: 8 }}>
            <Space align="center" size={token.marginSM}>
              <Avatar
                size={36}
                shape="square"
                icon={<CloudSyncOutlined />}
                style={{
                  background:token.colorFillSecondary,
                  color:  token.colorText,
                }}
              />
              <div>
                <Text strong style={{ display: 'block', fontSize: 14 }}>
                  Dropbox Sync
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Continuous sync across devices
                </Text>
              </div>
            </Space>
            {isDropboxActive ? (
              <Tag
                color="success"
                icon={<CheckCircleFilled />}
                style={{ margin: 0 }}
              >
                ACTIVE
              </Tag>
            ) : status?.connected ? (
              <Button
                size="small"
                type="primary"
                ghost
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  select('dropbox');
                }}
              >
                Use Dropbox
              </Button>
            ) : (
              <Button
                size="small"
                loading={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void beginLogin();
                }}
              >
                Connect
              </Button>
            )}
          </Flex>
        </div>
      </Flex>

      {status?.connected && (
        <Flex justify="space-between" align="center" wrap="wrap" gap={token.marginSM}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {isDropboxActive
              ? 'Copy your Dropbox data to Device Storage.'
              : 'Copy your device data to Dropbox.'}
          </Text>
          <Button size="small" icon={<SwapOutlined />} disabled={busy || !!verifier} onClick={transfer}>
            {isDropboxActive ? 'Copy to device' : 'Copy to Dropbox'}
          </Button>
        </Flex>
      )}

      {/* Dropbox Login Form if auth is in progress */}
      {verifier && (
        <div
          style={{
            padding: token.paddingSM,
            borderRadius: token.borderRadius,
            background: token.colorFillSecondary,
            border: `1px dashed ${token.colorBorderSecondary}`,
          }}
        >
          <Flex gap={8} align="center">
            <Input
              size="middle"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste Dropbox authorization code"
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              disabled={!code.trim()}
              loading={busy}
              onClick={() => void completeLogin()}
            >
              Finish sign-in
            </Button>
            <Button onClick={() => setVerifier('')}>Cancel</Button>
          </Flex>
        </div>
      )}

      {/* Active Dropbox Status & Actions Bar */}
      {isDropboxActive && (
        <Flex
          justify="space-between"
          align="center"
          wrap="wrap"
          gap={token.marginSM}
          style={{
            padding: `${token.paddingXS}px ${token.paddingMD}px`,
            borderRadius: token.borderRadius,
            background: token.colorFillQuaternary,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Space size={token.marginMD} wrap>
            {status?.account && (
              <Space size={6}>
                <Avatar size={20} icon={<UserOutlined />} />
                <Text style={{ fontSize: 13 }}>
                  {status.account.name ||
                    status.account.email ||
                    status.account.id}
                </Text>
              </Space>
            )}
            {status?.writes?.saving ? (
              <Space size={6}>
                <Spin size="small" />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Saving changes…
                </Text>
              </Space>
            ) : status?.writes?.lastSavedAt ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Last synced {new Date(status.writes.lastSavedAt).toLocaleTimeString()}
              </Text>
            ) : null}
          </Space>

          <Space size={token.marginXS}>
            <Button
              size="small"
              icon={<SyncOutlined />}
              loading={busy}
              onClick={() => void saveNow()}
            >
              Save now
            </Button>
          </Space>
        </Flex>
      )}

      <Flex justify="space-between" align="center">
        <Text strong>Dropbox accounts</Text>
        <Button size="small" disabled={busy || !!verifier} onClick={() => void beginLogin()}>Add account</Button>
      </Flex>
      {(status?.accounts ?? []).map((account) => {
        const active = isDropboxActive && status?.account?.id === account.id;
        return (
          <Flex key={account.id} justify="space-between" align="center" wrap="wrap" gap={token.marginSM}>
            <Space size={6}>
              <Avatar size={20} icon={<UserOutlined />} />
              <Text>{account.name || account.email || account.id}</Text>
              {active && <Tag color="success">ACTIVE</Tag>}
            </Space>
            <Space size={token.marginXS}>
              {!active && <Button size="small" disabled={busy} onClick={() => select('dropbox', account.id)}>Use</Button>}
              {!active && <Button size="small" type="text" danger icon={<DisconnectOutlined />} disabled={busy} onClick={() => disconnect(account.id)}>Unlink</Button>}
            </Space>
          </Flex>
        );
      })}

      {/* Subtle Error Display */}
      {displayError && (
        <Flex align="center" gap={6} style={{ color: token.colorError }}>
          <WarningOutlined />
          <Text type="danger" style={{ fontSize: 13 }}>
            {displayError}
          </Text>
        </Flex>
      )}
    </Card>
  );
};

export default StorageModeCard;
