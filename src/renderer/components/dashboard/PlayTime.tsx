import { useSettingsStore, selectStats } from '../../redux/settings';
import { alignSeries } from '../../../common/statsHistory';

import { useMemo } from 'react';
import { MdAccessTime } from 'react-icons/md';
import onlineTime from '../other/functions/onlineTime';
import StatCard from './StatCard';

const PlayTime = () => {
  const stats = useSettingsStore(selectStats);
  const { total, weeks } = useMemo(() => ({
    total: Object.values(stats?.alts ?? {}).reduce(
      (acc, alt) => acc + (alt?.playTime ?? 0),
      0,
    ),
    weeks: alignSeries(stats?.history?.onlineTime),
  }), [stats]);

  return (
    <StatCard
      title="Online time"
      value={onlineTime(total)}
      empty={!total}
      hint={!total ? 'No online time yet' : `+${onlineTime(weeks.at(-1) ?? 0)} this week`}
      trend={weeks}
      trendFormat={onlineTime}
      icon={<MdAccessTime />}
      tone="info"
    />
  );
};

export default PlayTime;
