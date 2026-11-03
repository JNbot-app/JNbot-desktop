import React from 'react';
import { Button, Tooltip } from 'antd';
import { ClockCircleOutlined, PlusOutlined } from '@ant-design/icons';
import Card from '../Card';
import CooldownTimeline from './ReminderTimeline';
import useOpenSchedule from './schedules/useOpenSchedule';

const GkitTimeline: React.FC = () => {
  const { openSchedule, canSchedule } = useOpenSchedule();

  return (
    <Card
      title="Cooldowns"
      icon={<ClockCircleOutlined />}
      extra={
        <Tooltip title="Schedule script">
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={() => openSchedule()}
            disabled={!canSchedule}
            aria-label="Schedule script"
          />
        </Tooltip>
      }
      style={{ height: '100%' }}
    >
      <CooldownTimeline openSchedule={openSchedule} canSchedule={canSchedule} />
    </Card>
  );
};

export default GkitTimeline;
