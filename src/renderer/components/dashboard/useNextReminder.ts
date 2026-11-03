import { useEffect, useMemo, useState } from 'react';
import { reminderDueAt, type Reminder } from '../../../common/cooldowns';
import { useSettingsStore, selectSettings } from '../../redux/settings';

const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * The next reminder that is still counting down, and how many are ready.
 * Re-evaluates once, exactly when that reminder becomes ready (no polling).
 */
const useNextReminder = () => {
  const reminders = useSettingsStore(selectSettings).reminders;
  const [now, setNow] = useState(Date.now);

  const status = useMemo(() => {
    let next: Reminder | undefined;
    let dueAt: number | undefined;
    let ready = 0;
    for (const r of reminders ?? []) {
      const due = reminderDueAt(r);
      if (due <= now) ready++;
      else if (dueAt === undefined || due < dueAt) {
        next = r;
        dueAt = due;
      }
    }
    return { next, dueAt, ready, count: reminders?.length ?? 0 };
  }, [reminders, now]);

  useEffect(() => {
    if (status.dueAt === undefined) return;
    const timeout = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, status.dueAt - Date.now()), MAX_TIMEOUT),
    );
    return () => clearTimeout(timeout);
  }, [status.dueAt]);

  return status;
};

export default useNextReminder;
