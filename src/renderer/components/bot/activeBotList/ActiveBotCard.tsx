import React, { useContext, useState } from 'react';
import {
  Avatar,
  Badge,
  Space,
  Tooltip,
  Typography,
  theme as antTheme,
} from 'antd';
import {
  ClockCircleOutlined,
  LoadingOutlined,
  PauseOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { AppContext } from '../../../redux/appContext';
import { formatJoinCountdown } from '../../../utils/joinQueue';
import ActiveBotActions from './ActiveBotActions';
import type { ActiveBotCardProps } from './types';

export const ActiveBotCard: React.FC<ActiveBotCardProps> = ({
  bot,
  selected = false,
  onSelect,
  compact = false,
  now,
}) => {
  const { token } = antTheme.useToken();
  const { openAccountProfile } = useContext(AppContext);
  const [isHovered, setIsHovered] = useState(false);

  const status = bot.status;
  const isPaused = bot.paused;
  const displayStatus = isPaused ? 'paused' : status;
  const isOnline = status === 'connected';
  const isFailed = status === 'failed';
  const isQueued = status === 'queued';
  const isDisabled = bot.origin === 'minecraft' || bot.status !== "connected";
  const isClickable = Boolean(onSelect) && !isDisabled;

  const getStatusIcon = () => {
    switch (displayStatus) {
      case 'joining':
        return <LoadingOutlined style={{ color: token.colorPrimary }} />;
      case 'connected':
        return null;
      case 'failed':
        return <WarningOutlined style={{ color: token.colorError }} />;
      case 'paused':
        return <PauseOutlined style={{ color: token.colorInfo }} />;
      default:
        return <ClockCircleOutlined style={{ color: token.colorTextSecondary }} />;
    }
  };

  const badgeStatus = isOnline
    ? 'success'
    : isFailed
      ? 'error'
      : isPaused
        ? 'default'
        : 'processing';

  let borderColor = token.colorBorderSecondary;
  let bgColor = 'transparent';

  if (selected) {
    borderColor = token.colorPrimary;
    bgColor = `${token.colorPrimary}18`;
  } else if (isHovered && isClickable) {
    bgColor = token.colorFillTertiary;
  } else if (isFailed) {
    borderColor = `${token.colorError}33`;
    bgColor = `${token.colorError}0d`;
  } else if (isPaused) {
    borderColor = `${token.colorInfo}40`;
    bgColor = `${token.colorInfo}0d`;
  } else if (isQueued) {
    borderColor = `${token.colorPrimary}33`;
    bgColor = `${token.colorPrimary}0d`;
  } else if (isOnline) {
    borderColor = `${token.colorSuccess}2b`;
    bgColor = `${token.colorSuccess}0a`;
  }

  const handleClick = () => {
    if (isClickable && onSelect) {
      onSelect(bot);
    }
  };

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: compact ? '8px 10px' : '10px 12px',
        borderRadius: token.borderRadius,
        border: `1px solid ${borderColor}`,
        backgroundColor: bgColor,
        cursor: isDisabled ? 'not-allowed' : isClickable ? 'pointer' : 'default',
        opacity: isDisabled ? 0.6 : 1,
        transition: 'all 0.15s ease',
        gap: compact ? 8 : 10,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 8 : 10,
          flex: 1,
          minWidth: 0,
        }}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Badge status={badgeStatus} offset={compact ? [-4, 4] : [-6, 6]}>
            <Avatar
              shape="square"
              size={compact ? 36 : 40}
              src={`https://crafthead.net/avatar/${bot.username || 'steve'}?size=128&default=MHF_Steve`}
            />
          </Badge>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <Typography.Text
            strong
            ellipsis
            style={{
              cursor: !isClickable ? 'pointer' : undefined,
              fontSize: compact ? 13 : 14,
              lineHeight: '18px',
            }}
            onClick={(e) => {
              if (!isClickable && openAccountProfile) {
                e.stopPropagation();
                openAccountProfile(bot.username);
              }
            }}
          >
            {bot.username}
          </Typography.Text>

          <Space size={6} style={{ minWidth: 0 }}>
            {displayStatus !== 'connected' && (
              <Space size={4} style={{ flexShrink: 0 }}>
                {getStatusIcon()}
                <Tooltip
                  title={
                    displayStatus === 'queued'
                      ? 'You can change the queue delay in settings > scripts > Bot join delay'
                      : undefined
                  }
                >
                  <Typography.Text
                    type={isFailed ? 'danger' : 'secondary'}
                    style={{
                      fontSize: 12,
                      color: isPaused ? token.colorInfo : undefined,
                    }}
                  >
                    {displayStatus}
                    {displayStatus === 'queued' && now && (
                      <> · joins in {formatJoinCountdown(bot.joinAt, now)}</>
                    )}
                  </Typography.Text>
                </Tooltip>
              </Space>
            )}
            <Typography.Text type="secondary" ellipsis style={{ fontSize: 12 }}>
              {bot.SCRIPT_ID || bot.SCRIPT_NAME}
            </Typography.Text>
          </Space>
        </div>
      </div>

      <ActiveBotActions bot={bot} compact={compact} />
    </div>
  );
};

export default ActiveBotCard;
