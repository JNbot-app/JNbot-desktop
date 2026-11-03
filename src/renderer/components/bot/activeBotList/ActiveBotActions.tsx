import React from 'react';
import { Button, Tooltip, Space } from 'antd';
import {
  CloseOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  PauseOutlined,
} from '@ant-design/icons';
import { MdPlayArrow } from 'react-icons/md';
import type { ActiveBotActionsProps } from './types';
import {
  SCRIPT_ACTION_BUTTONS,
  stopBot,
  nextBot,
  prevBot,
  relogBot,
  resumeBot,
  pauseBot,
} from './botActionConfigs';

export const ActiveBotActions: React.FC<ActiveBotActionsProps> = ({
  bot,
  compact = false,
}) => {
  if (bot.origin === 'minecraft') return null;

  const status = bot.status;
  const isPaused = bot.paused;

  // A queued bot does not have a bot messenger yet
  if (status === 'queued') return null;

  const config = SCRIPT_ACTION_BUTTONS[bot.SCRIPT_NAME];
  const btnSize = 'small';

  return (
    <Space
      size={compact ? 0 : 2}
      onClick={(e) => e.stopPropagation()}
      style={{ flexShrink: 0 }}
    >
      {config?.pause && (
        <>
          {isPaused ? (
            <Tooltip title="Resume" key="resume">
              <Button
                icon={<MdPlayArrow />}
                onClick={() => resumeBot(bot)}
                type="text"
                size={btnSize}
              />
            </Tooltip>
          ) : (
            status !== 'failed' && (
              <Tooltip title="Pause" key="pause">
                <Button
                  icon={<PauseOutlined />}
                  onClick={() => pauseBot(bot)}
                  type="text"
                  size={btnSize}
                />
              </Tooltip>
            )
          )}
        </>
      )}

      {config?.prev && (
        <Tooltip title="Previous alt" key="prev">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => prevBot(bot)}
            type="text"
            size={btnSize}
          />
        </Tooltip>
      )}

      {config?.next && (
        <Tooltip title="Next alt" key="next">
          <Button
            icon={<ArrowRightOutlined />}
            onClick={() => nextBot(bot)}
            type="text"
            size={btnSize}
          />
        </Tooltip>
      )}

      {config?.relog && (
        <Tooltip title="Rejoin" key="relog">
          <Button
            icon={<ReloadOutlined />}
            onClick={() => relogBot(bot)}
            type="text"
            size={btnSize}
          />
        </Tooltip>
      )}

      <Tooltip
        title={status === 'failed' ? 'Remove' : 'Stop alt'}
        key="stop"
      >
        <Button
          icon={<CloseOutlined />}
          onClick={() => stopBot(bot)}
          type="text"
          size={btnSize}
          danger
        />
      </Tooltip>
    </Space>
  );
};

export default ActiveBotActions;
