import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, Flex, Tooltip, Typography } from 'antd';
import { ExperimentOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  newTrigger,
  triggerAppliesTo,
  type Trigger,
} from '../../../../common/triggers';
import {
  selectAltTags,
  selectSettings,
  useSettingsStore,
} from '../../../redux/settings';
import botEvents from '../../../utils/botEvents';
import TriggerRow from '../../triggers/TriggerRow';
import { useOpenTrigger } from '../../triggers/triggerUi';
import type { BotInfo } from '../types';

dayjs.extend(relativeTime);

const EMPTY: Trigger[] = [];

interface TriggersProps {
  selectedBot: BotInfo;
  small?: boolean;
}

/** Triggers that apply to this bot, with their last run and a test button. */
const Triggers: React.FC<TriggersProps> = ({ selectedBot, small = false }) => {
  const { botId, username } = selectedBot;
  const triggers = useSettingsStore((s) => selectSettings(s).triggers ?? EMPTY);
  const altTags = useSettingsStore(selectAltTags);
  const openTrigger = useOpenTrigger();
  const navigate = useNavigate();
  const [lastFired, setLastFired] = useState<Record<string, number>>({});

  useEffect(() => {
    setLastFired({});
    const unsubscribe = botEvents.subscribe(botId, 'triggers', (data) =>
      setLastFired({ ...(data ?? {}) }),
    );
    botEvents.action(botId, 'triggersPacket');
    return unsubscribe;
  }, [botId]);

  const applicable = triggers.filter((trigger) =>
    triggerAppliesTo(trigger, username, altTags),
  );

  return (
    <div>
      <Flex
        align="center"
        justify="space-between"
        gap={12}
        wrap
        style={{ marginBottom: 12 }}
      >
        <Typography.Title level={small ? 5 : 4} style={{ margin: 0 }}>
          Triggers for {username}
        </Typography.Title>
        <Flex gap={8}>
          <Button onClick={() => navigate('/triggers')}>All triggers</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() =>
              openTrigger(newTrigger(crypto.randomUUID(), { alts: [username] }))
            }
          >
            {small ? null : 'Add'}
          </Button>
        </Flex>
      </Flex>
      <Card styles={{ body: { padding: 0 } }}>
        {applicable.length ? (
          applicable.map((trigger) => (
            <TriggerRow
              key={trigger.id}
              trigger={trigger}
              altTags={altTags}
              compact={small}
              extra={
                <>
                  {lastFired[trigger.id] && (
                    <Typography.Text type="secondary">
                      {dayjs(lastFired[trigger.id]).fromNow()}
                    </Typography.Text>
                  )}
                  <Tooltip title="Run the actions now with sample data">
                    <Button
                      type="text"
                      icon={<ExperimentOutlined />}
                      aria-label="Test trigger"
                      onClick={() =>
                        botEvents.action(botId, 'testTrigger', trigger.id)
                      }
                    />
                  </Tooltip>
                </>
              }
            />
          ))
        ) : (
          <Empty
            style={{ padding: 24 }}
            description="No triggers apply to this bot."
          />
        )}
      </Card>
    </div>
  );
};

export default Triggers;
