import { MdSmartToy } from 'react-icons/md';
import { useSettingsStore, selectStats } from '../../redux/settings';
import { alignSeries } from '../../../common/statsHistory';

import { useMemo } from 'react';
import StatCard from './StatCard';

const format = new Intl.NumberFormat().format;

const TotalOnlineBots = () => {
  const stats = useSettingsStore(selectStats);
  const { total, weeks } = useMemo(() => ({
    total: Object.values(stats?.alts ?? {}).reduce(
      (acc, alt) => acc + (alt?.joinCount ?? 0),
      0,
    ),
    weeks: alignSeries(stats?.history?.botsJoined),
  }), [stats]);

  return (
    <StatCard
      title="Bots joined"
      value={format(total)}
      empty={!total}
      hint={!total ? 'No bots joined yet' : `+${format(weeks.at(-1) ?? 0)} this week`}
      trend={weeks}
      trendFormat={(v) => `${format(v)} joined`}
      icon={<MdSmartToy />}
      tone="danger"
    />
  );
};

export default TotalOnlineBots;
