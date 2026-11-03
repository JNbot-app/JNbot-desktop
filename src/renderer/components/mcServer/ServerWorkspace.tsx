import React, { useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  Result,
  Row,
  Skeleton,
  Tabs,
  Typography,
  theme,
} from 'antd';
import {
  DesktopOutlined,
  GlobalOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { MinecraftServerSummary } from '../../../common/minecraftServers';
import ServerCard from './ServerCard';
import type { ServerActions } from './types';

export type McServerView = 'hosted' | 'joined';

interface ServerWorkspaceProps extends ServerActions {
  hosted: MinecraftServerSummary[];
  joined: MinecraftServerSummary[];
  view: McServerView;
  loading: boolean;
  error?: string;
  busy?: string;
  onRetry: () => void;
  onCreate: () => void;
  onJoin: () => void;
  onViewChange: (view: McServerView) => void;
}

const ServerWorkspace: React.FC<ServerWorkspaceProps> = ({
  hosted,
  joined,
  loading,
  error,
  busy,
  view,
  onViewChange,
  onRetry,
  onCreate,
  onJoin,
  ...actions
}) => {
  const { token } = theme.useToken();
  const [searchQuery, setSearchQuery] = useState('');

  const activeServers = view === 'hosted' ? hosted : joined;
  const filteredServers = activeServers.filter((server) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      server.name.toLowerCase().includes(query) ||
      server.version.toLowerCase().includes(query) ||
      (server.localAddress && server.localAddress.toLowerCase().includes(query))
    );
  });

  const tabItems = [
    {
      key: 'hosted',
      label: (
        <Flex align="center" gap={token.marginXS}>
          <DesktopOutlined />
          <span>Hosted ({hosted.length})</span>
        </Flex>
      ),
    },
    {
      key: 'joined',
      label: (
        <Flex align="center" gap={token.marginXS}>
          <GlobalOutlined />
          <span>Joined ({joined.length})</span>
        </Flex>
      ),
    },
  ];

  return (
    <Flex vertical gap={token.marginMD}>
      <Tabs
        activeKey={view}
        onChange={(key) => {
          onViewChange(key as McServerView);
          setSearchQuery('');
        }}
        items={tabItems}
        tabBarExtraContent={
          <Input
            allowClear
            size="middle"
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="Filter servers…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 220, maxWidth: '100%' }}
          />
        }
      />

      {/* Workspace Content */}
      {error ? (
        <Card
          style={{
            borderRadius: token.borderRadiusLG,
            borderColor: token.colorBorderSecondary,
            background: token.colorBgContainer,
          }}
        >
          <Result
            status="error"
            title="Failed to load servers"
            subTitle={error}
            extra={
              <Button icon={<ReloadOutlined />} onClick={onRetry}>
                Try Again
              </Button>
            }
          />
        </Card>
      ) : loading ? (
        <Row gutter={[token.marginMD, token.marginMD]}>
          {[1, 2, 3].map((key) => (
            <Col xs={24} md={12} xl={8} key={key}>
              <Card
                style={{
                  borderRadius: token.borderRadiusLG,
                  borderColor: token.colorBorderSecondary,
                  background: token.colorBgContainer,
                }}
              >
                <Skeleton active avatar paragraph={{ rows: 3 }} />
              </Card>
            </Col>
          ))}
        </Row>
      ) : filteredServers.length === 0 ? (
        <Card
          style={{
            borderRadius: token.borderRadiusLG,
            borderColor: token.colorBorderSecondary,
            background: token.colorBgContainer,
            padding: `${token.paddingLG}px 0`,
          }}
        >
          {activeServers.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Typography.Text type="secondary">
                  {view === 'hosted'
                    ? 'You are not hosting any Minecraft worlds yet.'
                    : 'No joined private servers found.'}
                </Typography.Text>
              }
            >
              <Button
                type="primary"
                icon={
                  view === 'hosted' ? <PlusOutlined /> : <LinkOutlined />
                }
                onClick={view === 'hosted' ? onCreate : onJoin}
              >
                {view === 'hosted' ? 'Create Server' : 'Join Server'}
              </Button>
            </Empty>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Typography.Text type="secondary">
                  No servers match "{searchQuery}"
                </Typography.Text>
              }
            >
              <Button onClick={() => setSearchQuery('')}>Clear Filter</Button>
            </Empty>
          )}
        </Card>
      ) : (
        <Row gutter={[token.marginMD, token.marginMD]}>
          {filteredServers.map((server) => (
            <Col xs={24} md={12} xl={8} key={server.id}>
              <ServerCard
                server={server}
                busy={busy === server.id}
                onStart={actions.onStart}
                onStop={actions.onStop}
                onCopy={actions.onCopy}
                onInvite={actions.onInvite}
                onOpen={actions.onOpen}
                onRemove={actions.onRemove}
              />
            </Col>
          ))}
        </Row>
      )}
    </Flex>
  );
};

export default ServerWorkspace;
