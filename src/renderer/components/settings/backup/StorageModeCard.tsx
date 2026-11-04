import React, { useEffect, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Dropdown,
  Flex,
  Input,
  Radio,
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
  MoreOutlined,
  PlusOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import useAppApi from 'renderer/hooks/useAppApi';

const { Text, Title } = Typography;

type Status = {
  mode: 'local' | 'dropbox';
  connected: boolean;
  account?: { id: string; email?: string; name?: string };
  accounts: { id: string; email?: string; name?: string }[];
  writes?: { saving: boolean; lastSavedAt?: number; lastError?: string };
  startupError?: string;
};

const StorageOption: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  active: boolean;
  onSelect?: () => void;
  action?: React.ReactNode;
}> = ({ icon, title, description, active, onSelect, action }) => {
  const { token } = theme.useToken();
  const selectable = !active && !!onSelect;

  return (
    <div
      role="radio"
      aria-checked={active}
      onClick={selectable ? onSelect : undefined}
      style={{
        flex: '1 1 260px',
        minWidth: 240,
        padding: token.padding,
        borderRadius: token.borderRadiusLG,
        background: active ? token.colorPrimaryBg : token.colorBgContainer,
        border: `1px solid ${active ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        cursor: selectable ? 'pointer' : 'default',
        transition: `all ${token.motionDurationMid}`,
      }}
    >
      <Flex align="center" gap={token.marginSM}>
        <Avatar
          size={36}
          shape="square"
          icon={icon}
          style={{ background: token.colorFillSecondary, color: token.colorText, flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ display: 'block' }}>{title}</Text>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>{description}</Text>
        </div>
        {active ? (
          <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: token.fontSizeLG }} />
        ) : (
          action ?? <Radio checked={false} disabled={!onSelect} />
        )}
      </Flex>
    </div>
  );
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
  const accounts = status?.accounts ?? [];
  const accountName = (account: Status['accounts'][number]) =>
    account.name || account.email || account.id;

  const syncStatus = status?.writes?.saving ? (
    <Space size={6}>
      <Spin size="small" />
      <Text type="secondary">Saving changes…</Text>
    </Space>
  ) : status?.writes?.lastSavedAt ? (
    <Text type="secondary">
      Last synced {new Date(status.writes.lastSavedAt).toLocaleTimeString()}
    </Text>
  ) : null;

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
          gap: token.marginLG,
        },
      }}
    >
      <div>
        <Title level={5} style={{ margin: 0 }}>
          Storage location
        </Title>
        <Text type="secondary">
          Choose where your live profiles, accounts, and plugins are stored.
        </Text>
      </div>

      <Flex gap={token.marginSM} wrap="wrap">
        <StorageOption
          icon={<DesktopOutlined />}
          title="Device storage"
          description="Stored locally on this computer"
          active={isLocalActive}
          onSelect={!busy ? () => select('local') : undefined}
        />
        <StorageOption
          icon={<CloudSyncOutlined />}
          title="Dropbox sync"
          description="Continuous sync across devices"
          active={isDropboxActive}
          onSelect={
            status?.connected && !busy ? () => select('dropbox') : undefined
          }
          action={
            status?.connected ? undefined : (
              <Button
                size="small"
                loading={busy}
                onClick={() => void beginLogin()}
              >
                Connect
              </Button>
            )
          }
        />
      </Flex>

      {verifier && (
        <Flex
          gap={token.marginXS}
          align="center"
          style={{
            padding: token.paddingSM,
            borderRadius: token.borderRadius,
            background: token.colorFillQuaternary,
            border: `1px dashed ${token.colorBorderSecondary}`,
          }}
        >
          <Input
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
      )}

      {accounts.length > 0 && (
        <Flex vertical gap={token.marginXS}>
          <Flex justify="space-between" align="center">
            <Text strong>Dropbox accounts</Text>
            <Button
              size="small"
              type="text"
              icon={<PlusOutlined />}
              disabled={busy || !!verifier}
              onClick={() => void beginLogin()}
            >
              Add account
            </Button>
          </Flex>
          <div
            style={{
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }}
          >
            {accounts.map((account, index) => {
              const active =
                isDropboxActive && status?.account?.id === account.id;
              return (
                <Flex
                  key={account.id}
                  justify="space-between"
                  align="center"
                  gap={token.marginSM}
                  style={{
                    padding: `${token.paddingSM}px ${token.padding}px`,
                    borderTop:
                      index > 0
                        ? `1px solid ${token.colorBorderSecondary}`
                        : undefined,
                  }}
                >
                  <Space size={token.marginXS}>
                    <Avatar size={24} icon={<UserOutlined />} />
                    <Text strong>{accountName(account)}</Text>
                    {active && <Tag color="success" style={{ margin: 0 }}>Active</Tag>}
                  </Space>
                  {active ? (
                    <Space size={token.marginSM}>
                      {syncStatus}
                      <Button
                        size="small"
                        type="text"
                        icon={<SyncOutlined />}
                        loading={busy}
                        onClick={() => void saveNow()}
                      >
                        Save now
                      </Button>
                    </Space>
                  ) : (
                    <Dropdown
                      trigger={['click']}
                      disabled={busy}
                      menu={{
                        items: [
                          { key: 'use', label: 'Use this account' },
                          {
                            key: 'unlink',
                            label: 'Unlink',
                            danger: true,
                            icon: <DisconnectOutlined />,
                          },
                        ],
                        onClick: ({ key }) =>
                          key === 'use'
                            ? select('dropbox', account.id)
                            : disconnect(account.id),
                      }}
                    >
                      <Button
                        size="small"
                        type="text"
                        aria-label="Account actions"
                        icon={<MoreOutlined />}
                      />
                    </Dropdown>
                  )}
                </Flex>
              );
            })}
          </div>
          {status?.connected && (
            <Flex justify="space-between" align="center" wrap="wrap" gap={token.marginSM}>
              <Text type="secondary">
                {isDropboxActive
                  ? 'Replace Device Storage with your Dropbox data.'
                  : 'Replace your Dropbox data with this device’s data.'}
              </Text>
              <Button
                size="small"
                icon={<SwapOutlined />}
                disabled={busy || !!verifier}
                onClick={transfer}
              >
                {isDropboxActive ? 'Copy to device' : 'Copy to Dropbox'}
              </Button>
            </Flex>
          )}
        </Flex>
      )}

      {displayError && (
        <Flex align="center" gap={6} style={{ color: token.colorError }}>
          <WarningOutlined />
          <Text type="danger">{displayError}</Text>
        </Flex>
      )}
    </Card>
  );
};

export default StorageModeCard;
