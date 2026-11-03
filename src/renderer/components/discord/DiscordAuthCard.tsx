import React, { useState, useEffect } from 'react';
import { Button, Card, Flex, Input, Space, Tooltip, Typography, theme } from 'antd';
import {
  CheckOutlined,
  CopyOutlined,
  ExportOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import useAppApi from '../../hooks/useAppApi';

const { Text } = Typography;

interface DiscordAuthCardProps {
  savedToken: string;
  onSaveToken: (token: string) => void;
}

const DiscordAuthCard: React.FC<DiscordAuthCardProps> = ({
  savedToken,
  onSaveToken,
}) => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const [tokenInput, setTokenInput] = useState(savedToken);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTokenInput(savedToken);
  }, [savedToken]);

  const handleSave = () => {
    const trimmed = tokenInput.trim();
    if (trimmed && (trimmed.length < 50 || trimmed.length > 256)) {
      message.error('Token length is invalid');
      return;
    }
    onSaveToken(trimmed);
  };

  const copyToken = async () => {
    if (!tokenInput) return;
    try {
      await navigator.clipboard.writeText(tokenInput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      message.success('Token copied');
    } catch {
      message.error('Failed to copy token');
    }
  };

  return (
    <Card
      size="small"
      style={{
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flex align="center" justify="space-between" wrap="wrap" gap={token.marginSM}>
        <Space size="small">
          <KeyOutlined style={{ color: token.colorPrimary }} />
          <Text strong style={{ fontSize: token.fontSizeSM }}>
            Bot Token
          </Text>
        </Space>

        <Flex align="center" gap={token.marginSM} style={{ flex: 1, minWidth: 280, maxWidth: 650 }}>
          <Input
            style={{ flex: 1 }}
            type={tokenVisible ? 'text' : 'password'}
            placeholder="Paste Discord bot token"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onPressEnter={handleSave}
            suffix={
              <Space size={2}>
                <Tooltip title={tokenVisible ? 'Hide token' : 'Show token'}>
                  <Button
                    type="text"
                    size="small"
                    icon={tokenVisible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                    onClick={() => setTokenVisible((v) => !v)}
                  />
                </Tooltip>
                <Tooltip title="Copy token">
                  <Button
                    type="text"
                    size="small"
                    icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                    onClick={copyToken}
                  />
                </Tooltip>
              </Space>
            }
          />
          <Button
            type="primary"
            onClick={handleSave}
            disabled={tokenInput.trim() === savedToken}
          >
            Save
          </Button>
        </Flex>

        <Tooltip title="Open Discord Developer Portal to get or reset your bot token">
          <Button
            type="text"
            size="small"
            icon={<ExportOutlined />}
            onClick={() => window.open('https://discord.com/developers/applications', '_blank')}
          >
            Developer Portal
          </Button>
        </Tooltip>
      </Flex>
    </Card>
  );
};

export default DiscordAuthCard;
