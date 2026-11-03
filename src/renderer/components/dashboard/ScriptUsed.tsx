import { MdDescription } from 'react-icons/md';
import { useSettingsStore, selectStats } from '../../redux/settings';
import { alignSeries } from '../../../common/statsHistory';

import { useMemo } from 'react';
import StatCard from './StatCard';

const format = new Intl.NumberFormat().format;

const ScriptUsed = () => {
  const stats = useSettingsStore(selectStats);
  const { total, weeks } = useMemo(() => ({
    total: Object.values(stats?.scripts ?? {}).reduce(
      (acc, script) => acc + (script?.activeCount ?? 0),
      0,
    ),
    weeks: alignSeries(stats?.history?.scriptsStarted),
  }), [stats]);
  return (
    <StatCard
      title="Scripts started"
      value={format(total)}
      empty={!total}
      hint={!total ? 'No scripts started yet' : `+${format(weeks.at(-1) ?? 0)} this week`}
      icon={<MdDescription />}
      tone="link"
    />
  );
};

export default ScriptUsed;
