import { FC } from 'react';
import { Badge, Tooltip, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import type { Chain } from '../../../../main/src/types';
import { chainPluginId, chainReadyAt } from '../../../../common/chains';
import { formatDuration, type Reminder } from '../../../../common/cooldowns';
import { selectScripts, useSettingsStore } from '../../../redux/settings';
import useNow from '../../../hooks/useNow';

const EMPTY_REMINDERS: Reminder[] = [];

/** Running, or the time until its actions' soonest cooldown is over. */
const ChainStatus: FC<{ chain: Chain }> = ({ chain }) => {
  const scripts = useSettingsStore(selectScripts);
  const reminders = useSettingsStore((state) => state.settings.reminders ?? EMPTY_REMINDERS);
  const now = useNow(30_000);

  if (scripts.isScriptActiveById(chainPluginId(chain.id)))
    return <Badge status="processing" text="Running" />;

  const readyAt = chainReadyAt(chain, reminders);
  if (readyAt === undefined || readyAt <= now) return null;
  return (
    <Tooltip title="Time until the soonest cooldown of its actions is over">
      <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        <ClockCircleOutlined /> {formatDuration(readyAt - now)}
      </Typography.Text>
    </Tooltip>
  );
};

export default ChainStatus;
