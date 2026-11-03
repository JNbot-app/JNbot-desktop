/** Node's timer delay is signed 32-bit; keep longer deadlines as bounded intervals. */
export default function scheduleDeadline(
  deadline: number,
  expire: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout>;
  let cancelled = false;
  const schedule = () => {
    if (cancelled) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    timer = setTimeout(schedule, Math.min(2_147_483_647, remaining));
    timer.unref?.();
  };
  schedule();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
