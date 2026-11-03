import { MdArrowCircleRight } from 'react-icons/md';
import StatCard from './StatCard';
import useNextReminder from './useNextReminder';
import useOpenSchedule from './schedules/useOpenSchedule';

const NextCooldown = () => {
  const { next, ready, count } = useNextReminder();
  const { openSchedule, canSchedule } = useOpenSchedule();

  return (
    <StatCard
      title="Next cooldown"
      value={next ? next.name ?? next.reminderId : count ? 'All ready' : 'None'}
      empty={!count}
      action={canSchedule ? { label: 'Schedule a script', onClick: () => openSchedule() } : undefined}
      hint={!count ? 'No cooldowns yet' : ready ? `${ready} of ${count} ready` : 'None ready'}
      icon={<MdArrowCircleRight />}
      tone="success"
    />
  );
};

export default NextCooldown;
