import React from 'react';
import {
  Badge,
  Button,
  Card,
  Collapse,
  Dropdown,
  Empty,
  Flex,
  Select,
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
import type { McpActivitySnapshot, McpAuditEvent } from '../../../common/mcp';
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
  const [clientFilter, setClientFilter] = React.useState('');
  const clientNames = [...new Set(audit.map((event) => event.clientName))];
  const history = clientFilter
    ? audit.filter((event) => event.clientName === clientFilter)
    : audit;

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
        {clientNames.length > 1 && (
          <Select
            size="small"
            value={clientFilter}
            onChange={setClientFilter}
            style={{ minWidth: 180, marginBottom: token.marginSM }}
            options={[
              { value: '', label: 'All clients' },
              ...clientNames.map((name) => ({ value: name, label: name })),
            ]}
          />
        )}
        {history.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No activity yet"
            style={{ padding: `${token.paddingMD}px 0` }}
          />
        ) : (
          <Collapse
            ghost
            size="small"
            items={history.slice(0, 100).map((event, index) => ({
              key: event.id ?? index,
              label: <HistoryLabel event={event} />,
              children: (
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 200,
                    overflow: 'auto',
                    fontSize: token.fontSizeSM,
                    fontFamily: token.fontFamilyCode,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {event.error ?? event.output ?? 'No result yet.'}
                </pre>
              ),
            }))}
          />
        )}
      </Card>
    </Flex>
  );
};

const HistoryLabel: React.FC<{ event: McpAuditEvent }> = ({ event }) => {
  const status = event.result === 'success' ? 'success' : event.result === 'pending' ? 'processing' : 'error';
  const details = [
    event.clientName,
    event.decision.replace('_', ' '),
    event.durationMs !== undefined && `${(event.durationMs / 1000).toFixed(1)}s`,
    formatTime(event.timestamp),
  ].filter(Boolean);
  return (
    <Flex align="center" gap={8} style={{ minWidth: 0 }}>
      <Badge status={status} />
      <div style={{ minWidth: 0 }}>
        <Text strong style={{ fontSize: 13 }}>
          {event.summary ?? event.tool}
        </Text>
        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          {details.join(' · ')}
        </Text>
      </div>
    </Flex>
  );
};

export default McpActivityTab;
