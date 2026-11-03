import React, { useState } from 'react';
import { Avatar, Badge, Button, Flex, Space, Tag, Tooltip, Typography, theme } from 'antd';
import {
  CheckOutlined,
  CopyOutlined,
  ExportOutlined,
  GlobalOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { FaDiscord } from 'react-icons/fa';
import type { DiscordStats } from './types';
import useAppApi from '../../hooks/useAppApi';

const { Title, Text } = Typography;

interface DiscordHeaderProps {
  isActive: boolean;
  isLoading: boolean;
  stats: DiscordStats;
  inviteUrl: string | null;
  onToggleBot: () => void;
}

const DiscordHeader: React.FC<DiscordHeaderProps> = ({
  isActive,
  isLoading,
  stats,
  inviteUrl,
  onToggleBot,
}) => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      message.success('Invite link copied');
    } catch {
      message.error('Failed to copy link');
    }
  };

  const displayName = stats.online && stats.tag ? stats.tag : 'Discord Bot';

  return (
    <Flex justify="space-between" align="center" wrap="wrap" gap={token.marginMD}>
      <Flex align="center" gap={token.marginMD}>
        <Avatar
          shape="square"
          size={46}
          style={{
            backgroundColor: '#5865F2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: token.borderRadiusLG,
            boxShadow: '0 2px 8px rgba(88, 101, 242, 0.25)',
          }}
          icon={<FaDiscord size={26} color="#FFFFFF" />}
        />
        <div>
          <Flex align="center" gap={token.marginXS}>
            <Title level={4} style={{ margin: 0, fontWeight: 600 }}>
              {displayName}
            </Title>
            <Badge status={isActive ? 'success' : 'default'} style={{ marginLeft: 4 }} />
            <Tag
              color={isActive ? 'success' : 'default'}
              style={{
                borderRadius: token.borderRadiusSM,
                fontSize: token.fontSizeSM - 1,
                lineHeight: '18px',
                padding: '0 6px',
              }}
            >
              {isActive ? 'Online' : 'Offline'}
            </Tag>
          </Flex>

          <Space size="small" style={{ marginTop: 2 }}>
            {stats.online && stats.guildName ? (
              <>
                <Tag
                  icon={<GlobalOutlined />}
                  color="blue"
                  style={{ borderRadius: token.borderRadiusSM, margin: 0 }}
                >
                  {stats.guildName}
                  {stats.memberCount > 0 && ` · ${stats.memberCount.toLocaleString()}`}
                </Tag>
                {stats.applicationId && (
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    ID: {stats.applicationId}
                  </Text>
                )}
              </>
            ) : (
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                Bridge JNbot with Discord slash commands
              </Text>
            )}
          </Space>
        </div>
      </Flex>

      <Space wrap size="small">
        {inviteUrl && (
          <Tooltip title="Copy OAuth2 invite link">
            <Button
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={copyInvite}
            >
              {copied ? 'Copied' : 'Copy Link'}
            </Button>
          </Tooltip>
        )}

        <Tooltip title={!inviteUrl ? 'Start the bot to generate an invite link' : 'Authorize bot in browser'}>
          <Button
            icon={<ExportOutlined />}
            disabled={!inviteUrl}
            onClick={() => inviteUrl && window.open(inviteUrl, '_blank')}
          >
            Invite Bot
          </Button>
        </Tooltip>

        <Button
          type="primary"
          danger={isActive}
          loading={isLoading}
          onClick={onToggleBot}
          icon={isActive ? <PoweroffOutlined /> : <PlayCircleOutlined />}
        >
          {isActive ? 'Stop Bot' : 'Start Bot'}
        </Button>
      </Space>
    </Flex>
  );
};

export default DiscordHeader;
