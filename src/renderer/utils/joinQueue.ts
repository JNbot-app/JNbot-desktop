import { useEffect, useState } from 'react';

/** Keep queued-join countdowns current without creating a timer per bot row. */
export function useJoinQueueClock(enabled: boolean): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!enabled) return () => {};
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}

export function formatJoinCountdown(
  joinAt: number | undefined,
  now: number,
): string {
  const seconds = Math.max(0, Math.ceil(((joinAt ?? now) - now) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
