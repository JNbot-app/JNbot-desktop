import React, { useMemo, useState } from 'react';
import { Button, Card, Col, Flex, Row, Segmented, Space, Tag, Tooltip, Typography, theme } from 'antd';
import { CodeOutlined, CopyOutlined } from '@ant-design/icons';
import { DISCORD_COMMANDS } from './types';
import useAppApi from '../../hooks/useAppApi';

const { Text } = Typography;

const DiscordCommandsGrid: React.FC = () => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const [filter, setFilter] = useState<string>('All');
  const [hoveredCmd, setHoveredCmd] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'All') return DISCORD_COMMANDS;
    return DISCORD_COMMANDS.filter((c) => c.category === filter);
  }, [filter]);

  const copyCommand = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      message.success(`Copied ${name}`);
    } catch {
      message.error('Failed to copy command');
    }
  };

  return (
    <Card
      size="small"
      style={{
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
      title={
        <Space size="small">
          <CodeOutlined />
          <span>Slash Commands</span>
        </Space>
      }
      extra={
        <Segmented
          size="small"
          options={['All', 'Scripts', 'Bots', 'Utility']}
          value={filter}
          onChange={(val) => setFilter(val as string)}
        />
      }
    >
      <Row gutter={[token.marginSM, token.marginSM]}>
        {filtered.map((cmd) => {
          const isHovered = hoveredCmd === cmd.name;
          return (
            <Col xs={24} sm={12} key={cmd.name}>
              <div
                onClick={() => copyCommand(cmd.name)}
                onMouseEnter={() => setHoveredCmd(cmd.name)}
                onMouseLeave={() => setHoveredCmd(null)}
                style={{
                  padding: `${token.paddingXS + 2}px ${token.paddingSM}px`,
                  borderRadius: token.borderRadiusLG,
                  border: `1px solid ${
                    isHovered ? token.colorPrimaryBorder : token.colorBorderSecondary
                  }`,
                  backgroundColor: isHovered ? token.colorFillAlter : token.colorBgContainer,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-in-out',
                }}
              >
                <Flex justify="space-between" align="center" gap={token.marginSM}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Space size="small" wrap style={{ marginBottom: 2 }}>
                      <Text
                        code
                        strong
                        style={{
                          color: token.colorPrimary,
                          fontSize: token.fontSizeSM,
                        }}
                      >
                        {cmd.syntax}
                      </Text>
                      <Tag style={{ margin: 0, fontSize: 11, padding: '0 4px', lineHeight: '16px' }}>
                        {cmd.category}
                      </Tag>
                    </Space>
                    <div>
                      <Text type="secondary" style={{ fontSize: token.fontSizeSM - 1 }}>
                        {cmd.description}
                      </Text>
                    </div>
                  </div>

                  <Tooltip title="Copy command">
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined style={{ color: isHovered ? token.colorPrimary : undefined }} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyCommand(cmd.name);
                      }}
                    />
                  </Tooltip>
                </Flex>
              </div>
            </Col>
          );
        })}
      </Row>
    </Card>
  );
};

export default DiscordCommandsGrid;
