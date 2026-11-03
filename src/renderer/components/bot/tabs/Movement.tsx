import React, { useEffect, useState } from 'react';
import { Button, Typography, theme as antTheme } from 'antd';
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  PauseOutlined,
} from '@ant-design/icons';
import { BotInfo, MovementData } from '../types';
import { botEvents } from '../../../utils/botEvents';
import MovementAim from './MovementAim';

interface MovementProps {
  selectedBot: BotInfo;
}

type Control =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'sneak'
  | 'fly';

const EMPTY_MOVEMENT: MovementData = {
  jump: false,
  sprint: false,
  sneak: false,
  fly: false,
  left: false,
  right: false,
  forward: false,
  back: false,
  isPathfinding: false,
  pitch: 0,
  yaw: 0,
};

const directions = [
  {
    key: 'forward',
    label: 'Forward',
    icon: <ArrowUpOutlined />,
    area: 'forward',
  },
  { key: 'left', label: 'Left', icon: <ArrowLeftOutlined />, area: 'left' },
  { key: 'right', label: 'Right', icon: <ArrowRightOutlined />, area: 'right' },
  { key: 'back', label: 'Back', icon: <ArrowDownOutlined />, area: 'back' },
] as const;
const actions = ['jump', 'sprint', 'sneak', 'fly'] as const;

function Movement({ selectedBot }: MovementProps) {
  const { token } = antTheme.useToken();
  const [movement, setMovement] = useState<MovementData>(EMPTY_MOVEMENT);
  const { botId } = selectedBot;

  useEffect(() => {
    setMovement(EMPTY_MOVEMENT);
    const unsubscribe = botEvents.subscribe(
      botId,
      'movement-state',
      (data: MovementData) => {
        if (data) setMovement(data);
      },
    );
    botEvents.action(botId, 'movementPacket');
    return unsubscribe;
  }, [botId]);

  const toggle = (key: Control) =>
    botEvents.action(botId, 'toggleMovement', key);
  const hasActiveMovement = (
    ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'] as const
  ).some((key) => movement[key]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
        gap: 24,
        alignItems: 'start',
      }}
    >
      <section aria-labelledby="movement-heading">
        <Typography.Title
          id="movement-heading"
          level={4}
          style={{ marginTop: 0, marginBottom: 4 }}
        >
          Move
        </Typography.Title>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gridTemplateAreas: '" . forward . " "left bot right" " . back . "',
            gap: 8,
            maxWidth: 320,
            margin: '20px auto 16px',
          }}
        >
          {directions.map(({ key, label, icon, area }) => (
            <Button
              key={key}
              icon={icon}
              type={movement[key] ? 'primary' : 'default'}
              aria-pressed={movement[key]}
              onClick={() => toggle(key)}
              style={{
                gridArea: area,
                height: 64,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 2,
              }}
            >
              {label}
            </Button>
          ))}
          <div
            style={{
              gridArea: 'bot',
              display: 'grid',
              placeItems: 'center',
              borderRadius: token.borderRadiusLG,
              background: token.colorFillTertiary,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Typography.Text strong>BOT</Typography.Text>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {actions.map((key) => (
            <Button
              key={key}
              type={movement[key] ? 'primary' : 'default'}
              aria-pressed={movement[key]}
              onClick={() => toggle(key)}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </Button>
          ))}
        </div>
        <Button
          icon={<PauseOutlined />}
          onClick={() => botEvents.action(botId, 'stopMovement')}
          disabled={!hasActiveMovement}
          style={{ marginTop: 16 }}
        >
          Stop movement
        </Button>
      </section>
      <MovementAim
        key={botId}
        yaw={movement.yaw}
        pitch={movement.pitch}
        onAim={(angles) => botEvents.action(botId, 'setHeadRotation', angles)}
      />
    </div>
  );
}

export default Movement;
