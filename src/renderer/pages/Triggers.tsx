import { Button, Card, Empty, Flex, Space, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  newTrigger,
  triggerAppliesTo,
  type Trigger,
} from '../../common/triggers';
import {
  selectActiveBots,
  selectAltTags,
  selectSettings,
  useSettingsStore,
} from '../redux/settings';
import TriggerRow from '../components/triggers/TriggerRow';
import { useOpenTrigger } from '../components/triggers/triggerUi';

const EMPTY: Trigger[] = [];

/** One-click starting points, opened in the editor before saving. */
const STARTERS: { label: string; trigger: Partial<Trigger> }[] = [
  { label: 'Notify me when a bot is kicked', trigger: { event: 'kicked' } },
  {
    label: 'Post deaths to Discord',
    trigger: { event: 'death', actions: [{ type: 'discord', webhook: '' }] },
  },
  {
    label: 'Alert when a player comes near',
    trigger: { event: 'playerNearby' },
  },
  {
    label: 'Notify me when the inventory is full',
    trigger: { event: 'inventoryFull' },
  },
];

const Triggers = () => {
  const triggers = useSettingsStore((s) => selectSettings(s).triggers ?? EMPTY);
  const altTags = useSettingsStore(selectAltTags);
  const activeBots = useSettingsStore(selectActiveBots);
  const openTrigger = useOpenTrigger();

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Flex align="flex-start" justify="space-between" gap={16} wrap>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Triggers
          </Typography.Title>
          <Typography.Text type="secondary">
            React to bot events automatically. Triggers run on every matching
            bot while it is online.
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => openTrigger()}
        >
          Add trigger
        </Button>
      </Flex>

      <Card styles={{ body: { padding: 0 } }}>
        {triggers.length ? (
          triggers.map((trigger) => {
            const online = trigger.enabled
              ? activeBots.filter((bot) =>
                  triggerAppliesTo(trigger, bot.username, altTags),
                ).length
              : 0;
            return (
              <TriggerRow
                key={trigger.id}
                trigger={trigger}
                altTags={altTags}
                extra={
                  online > 0 && (
                    <Typography.Text type="success">
                      Live on {online} bot{online === 1 ? '' : 's'}
                    </Typography.Text>
                  )
                }
              />
            );
          })
        ) : (
          <Empty
            style={{ padding: 32 }}
            description="No triggers yet. Start from scratch or pick an example."
          >
            <Flex vertical align="center" gap={8}>
              {STARTERS.map(({ label, trigger }) => (
                <Button
                  key={label}
                  onClick={() =>
                    openTrigger(newTrigger(crypto.randomUUID(), trigger))
                  }
                >
                  {label}
                </Button>
              ))}
            </Flex>
          </Empty>
        )}
      </Card>
    </Space>
  );
};

export default Triggers;
