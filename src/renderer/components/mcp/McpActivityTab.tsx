import React from 'react';
import {
  Badge,
  Button,
  Card,
  Divider,
  Dropdown,
  Empty,
  Flex,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  MoreOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type { McpActivitySnapshot } from '../../../common/mcp';
import { formatTime } from './types';

const { Text } = Typography;

interface McpActivityTabProps {
  snapshot: McpActivitySnapshot;
  onRefresh: () => void;
  onClearAudit: () => void;
}

const McpActivityTab: React.FC<McpActivityTabProps> = ({
  snapshot,
  onRefresh,
  onClearAudit,
}) => {
  const { token } = theme.useToken();

  const operations = snapshot.operations ?? [];
  const audit = snapshot.audit ?? [];

  return (
    <Flex vertical gap={token.marginLG}>
      {/* Current Operations */}
      <Card
        size="small"
        title={
          <Flex justify="space-between" align="center">
            <Text strong>Current Operations</Text>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={onRefresh}
            >
              Refresh
            </Button>
          </Flex>
        }
        style={{
          borderColor: token.colorBorderSecondary,
          background: token.colorBgContainer,
        }}
        styles={{
          body: { padding: token.paddingMD },
        }}
      >
        {operations.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No active operations"
            style={{ padding: `${token.paddingMD}px 0` }}
          />
        ) : (
          <Flex vertical gap={token.marginXS}>
            {operations.map((op) => (
              <Flex
                key={op.operationId}
                justify="space-between"
                align="center"
                style={{
                  padding: `${token.paddingXS}px ${token.paddingSM}px`,
                  borderRadius: token.borderRadiusSM,
                  background: token.colorFillAlter,
                }}
              >
                <Flex align="center" gap={token.marginSM}>
                  {op.status === 'succeeded' ? (
                    <CheckCircleOutlined style={{ color: token.colorSuccess }} />
                  ) : op.status === 'running' ? (
                    <SyncOutlined spin style={{ color: token.colorPrimary }} />
                  ) : (
                    <EllipsisOutlined style={{ color: token.colorTextSecondary }} />
                  )}
                  <div>
                    <Text strong style={{ fontSize: 13 }}>
                      {op.summary}
                    </Text>
                    <Text
                      type="secondary"
                      style={{ display: 'block', fontSize: 12 }}
                    >
                      {op.tool} · {formatTime(op.updatedAt)}
                    </Text>
                  </div>
                </Flex>
                <Tag variant="filled" style={{ margin: 0 }}>
                  {op.status.replace('_', ' ')}
                </Tag>
              </Flex>
            ))}
          </Flex>
        )}
      </Card>

      {/* Audit History */}
      <Card
        size="small"
        title={
          <Flex justify="space-between" align="center">
            <Text strong>Recent History</Text>
            {audit.length > 0 && (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'clear',
                      label: 'Clear history',
                      danger: true,
                      icon: <DeleteOutlined />,
                      onClick: onClearAudit,
                    },
                  ],
                }}
              >
                <Button
                  type="text"
                  size="small"
                  aria-label="History options"
                  icon={<MoreOutlined />}
                />
              </Dropdown>
            )}
          </Flex>
        }
        style={{
          borderColor: token.colorBorderSecondary,
          background: token.colorBgContainer,
        }}
        styles={{
          body: { padding: token.paddingMD },
        }}
      >
        {audit.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No activity yet"
            style={{ padding: `${token.paddingMD}px 0` }}
          />
        ) : (
          <Flex vertical gap={token.marginXS}>
            {audit.slice(0, 50).map((event, index) => {
              let badgeStatus: 'success' | 'processing' | 'error' = 'error';
              if (event.result === 'success') badgeStatus = 'success';
              else if (event.result === 'pending') badgeStatus = 'processing';

              return (
                <div key={event.id ?? index}>
                  <Flex
                    justify="space-between"
                    align="center"
                    style={{
                      padding: `${token.paddingXS}px ${token.paddingSM}px`,
                      borderRadius: token.borderRadiusSM,
                    }}
                  >
                    <Flex align="center" gap={token.marginSM} style={{ minWidth: 0 }}>
                      <Badge status={badgeStatus} />
                      <div style={{ minWidth: 0 }}>
                        <Text strong style={{ fontSize: 13 }}>
                          {event.tool}
                        </Text>
                        <Text
                          type="secondary"
                          style={{ display: 'block', fontSize: 12 }}
                        >
                          {event.clientName} · {event.decision.replace('_', ' ')} ·{' '}
                          {formatTime(event.timestamp)}
                        </Text>
                        {event.error && (
                          <Text
                            type="danger"
                            style={{ display: 'block', fontSize: 12, marginTop: 2 }}
                          >
                            {event.error}
                          </Text>
                        )}
                      </div>
                    </Flex>
                  </Flex>
                  {index < Math.min(audit.length, 50) - 1 && (
                    <Divider style={{ margin: `${token.marginXXS}px 0` }} />
                  )}
                </div>
              );
            })}
          </Flex>
        )}
      </Card>
    </Flex>
  );
};

export default McpActivityTab;
