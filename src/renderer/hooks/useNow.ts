import { useEffect, useState } from 'react';

/** Current time, refreshed every `interval` ms while mounted. */
const useNow = (interval: number) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
};

export default useNow;
