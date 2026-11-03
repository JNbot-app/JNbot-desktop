import { MdRedeem } from 'react-icons/md';
import { FC } from 'react';
import { Progress, theme } from 'antd';
import type { Reminder } from '../../../common/cooldowns';
import StatCard from './StatCard';
import useNextReminder from './useNextReminder';
import useNow from '../../hooks/useNow';

function formatInterval(distance:number) {
  let days = Math.floor(distance / (1000 * 60 * 60 * 24));
  let hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  let minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));

  return days + 'd ' + hours + 'h ' + minutes + 'm';
}

// Ticking parts are isolated so only they rerender, not the whole card.
const Countdown: FC<{ dueAt: number }> = ({ dueAt }) => {
  const now = useNow(1000);
  return <>{dueAt > now ? formatInterval(dueAt - now) : 'Ready!'}</>;
};

const CooldownProgress: FC<{ start: number; duration: number }> = ({ start, duration }) => {
  const { token } = theme.useToken();
  const now = useNow(30_000);
  return (
    <Progress
      percent={Math.min(100, ((now - start) / duration) * 100)}
      showInfo={false}
      size="small"
      strokeColor={token.colorWarning}
      style={{ margin: 0 }}
    />
  );
};

const progressOf = (r?: Reminder) =>
  r && r.kind !== 'schedule' && r.cooldown > 0
    ? <CooldownProgress start={r.time} duration={r.cooldown} />
    : null;

const NextGkit = () => {
  const { next, dueAt, ready, count } = useNextReminder();

  return (
    <StatCard
      title="Next cooldown in"
      value={dueAt !== undefined ? <Countdown dueAt={dueAt} /> : ready ? 'Ready!' : '-'}
      empty={!count}
      hint={dueAt !== undefined
        ? new Date(dueAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
        : count ? 'Everything is ready' : 'No cooldowns yet'}
      footer={progressOf(next)}
      icon={<MdRedeem />}
      tone="warning"
    />
  );
};

export default NextGkit;
