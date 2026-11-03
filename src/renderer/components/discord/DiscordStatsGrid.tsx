import React from 'react';
import { Card, Col, Flex, Row, Typography, theme } from 'antd';
import {
  ClockCircleOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { DiscordStats } from './types';
import { formatUptime } from './types';

const { Text } = Typography;

interface DiscordStatsGridProps {
  stats: DiscordStats;
}

const DiscordStatsGrid: React.FC<DiscordStatsGridProps> = ({ stats }) => {
  const { token } = theme.useToken();

  if (!stats.online) return null;

  const items = [
    {
      title: 'Latency',
      value: `${Math.round(stats.ping)} ms`,
      icon: <ThunderboltOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />,
      color: stats.ping > 250 ? token.colorWarning : token.colorText,
    },
    {
      title: 'Uptime',
      value: formatUptime(stats.uptime),
      icon: <ClockCircleOutlined style={{ color: token.colorSuccess, fontSize: 18 }} />,
      color: token.colorText,
    },
    {
      title: 'Commands',
      value: stats.commands.toLocaleString(),
      icon: <CodeOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />,
      color: token.colorText,
    },
    {
      title: 'Errors',
      value: stats.errors.toLocaleString(),
      icon: (
        <WarningOutlined
          style={{
            color: stats.errors > 0 ? token.colorError : token.colorTextQuaternary,
            fontSize: 18,
          }}
        />
      ),
      color: stats.errors > 0 ? token.colorError : token.colorText,
    },
  ];

  return (
    <Row gutter={[token.marginMD, token.marginMD]}>
      {items.map((item) => (
        <Col xs={12} sm={6} key={item.title}>
          <Card
            size="small"
            style={{
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              backgroundColor: token.colorBgContainer,
            }}
          >
            <Flex align="center" gap={token.marginSM}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: token.borderRadiusLG,
                  backgroundColor: token.colorFillAlter,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {item.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM - 1, display: 'block' }}>
                  {item.title}
                </Text>
                <Text
                  style={{
                    fontSize: token.fontSizeLG,
                    fontWeight: 700,
                    color: item.color,
                    lineHeight: '22px',
                  }}
                >
                  {item.value}
                </Text>
              </div>
            </Flex>
          </Card>
        </Col>
      ))}
    </Row>
  );
};

export default DiscordStatsGrid;
