import React from 'react';
import { Button, Card, Flex, Space, Tag, Typography, theme } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { ActivityEvent, ActivityLevel } from './types';
import { formatTime } from './types';

const { Text } = Typography;

interface DiscordActivityFeedProps {
  activity: ActivityEvent[];
  onClear: () => void;
}

const levelTagColor = (level: ActivityLevel): string => {
  switch (level) {
    case 'success':
      return 'success';
    case 'warn':
      return 'warning';
    case 'error':
      return 'error';
    case 'info':
    default:
      return 'processing';
  }
};

const DiscordActivityFeed: React.FC<DiscordActivityFeedProps> = ({
  activity,
  onClear,
}) => {
  const { token } = theme.useToken();

  return (
    <Card
      size="small"
      style={{
        height: '100%',
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
      title={
        <Space size="small">
          <ThunderboltOutlined />
          <span>Activity Log</span>
          {activity.length > 0 && (
            <Tag color="blue" style={{ margin: 0, padding: '0 4px', fontSize: 11, lineHeight: '16px' }}>
              {activity.length}
            </Tag>
          )}
        </Space>
      }
      extra={
        activity.length > 0 && (
          <Button size="small" type="text" onClick={onClear}>
            Clear
          </Button>
        )
      }
    >
      <Flex vertical style={{ minHeight: 180 }}>
        {activity.length === 0 ? (
          <Flex
            align="center"
            justify="center"
            style={{
              flex: 1,
              padding: token.paddingMD,
              border: `1px dashed ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusLG,
              backgroundColor: token.colorFillAlter,
            }}
          >
            <Text type="secondary" style={{ fontSize: token.fontSizeSM, textAlign: 'center' }}>
              No recent activity recorded
            </Text>
          </Flex>
        ) : (
          <div
            style={{
              maxHeight: 232,
              overflowY: 'auto',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusLG,
            }}
          >
            {activity.map((item, idx) => (
              <Flex
                key={`${item.ts}-${idx}`}
                align="center"
                justify="space-between"
                gap={token.marginSM}
                style={{
                  padding: '6px 12px',
                  borderBottom:
                    idx !== activity.length - 1
                      ? `1px solid ${token.colorBorderSecondary}`
                      : undefined,
                  backgroundColor: token.colorBgContainer,
                }}
              >
                <Flex align="center" gap={token.marginXS} style={{ minWidth: 0, flex: 1 }}>
                  <Tag
                    color={levelTagColor(item.level)}
                    style={{ margin: 0, padding: '0 4px', fontSize: 10, lineHeight: '16px' }}
                  >
                    {item.level.toUpperCase()}
                  </Tag>
                  <Text ellipsis style={{ flex: 1, fontSize: token.fontSizeSM }}>
                    {item.message}
                  </Text>
                  <Tag style={{ margin: 0, padding: '0 4px', fontSize: 11, lineHeight: '16px' }}>
                    {item.kind}
                  </Tag>
                </Flex>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM - 1, whiteSpace: 'nowrap' }}>
                  {formatTime(item.ts)}
                </Text>
              </Flex>
            ))}
          </div>
        )}
      </Flex>
    </Card>
  );
};

export default DiscordActivityFeed;
