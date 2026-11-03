import React from 'react';
import { Typography } from 'antd';
import { useSettingsStore, selectActiveBots } from '../../../redux/settings';
import { useJoinQueueClock } from '../../../utils/joinQueue';
import ActiveBotCard from './ActiveBotCard';
import NoBotsOnlineSvg from './NoBotsOnlineSvg';
import type { ActiveBotsListProps } from './types';

export const ActiveBotsList: React.FC<ActiveBotsListProps> = ({
  selectedBotId,
  onSelectBot,
  compact = false,
  emptyText,
  style,
  className,
}) => {
  const activeBots = useSettingsStore(selectActiveBots);
  const now = useJoinQueueClock(
    activeBots.some((bot) => bot.status === 'queued'),
  );

  if (activeBots.length === 0) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
          width: '100%',
          ...style,
        }}
      >
        <NoBotsOnlineSvg
          size={compact ? 110 : 185}
          style={{ marginTop: compact ? '0.5rem' : '1rem' }}
        />
        {emptyText && (
          <Typography.Text
            type="secondary"
            style={{ marginTop: 8, fontSize: compact ? 12 : 14 }}
          >
            {emptyText}
          </Typography.Text>
        )}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 6 : 8,
        width: '100%',
        ...style,
      }}
    >
      {activeBots.map((bot) => (
        <ActiveBotCard
          key={bot.botId}
          bot={bot}
          selected={
            selectedBotId !== undefined &&
            selectedBotId !== null &&
            String(selectedBotId) === String(bot.botId)
          }
          onSelect={onSelectBot}
          compact={compact}
          now={now}
        />
      ))}
    </div>
  );
};

export default ActiveBotsList;
