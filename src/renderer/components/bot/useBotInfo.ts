import { useEffect, useState } from 'react';
import botActionHandler from './botActionHandler';
import botEvents from '../../utils/botEvents';
import type { InfoData } from './types';

/** Live, throttled info packet (health, hunger, position, ...) for a bot. */
export default function useBotInfo(botId: number) {
  const [info, setInfo] = useState<InfoData>({});

  useEffect(() => {
    setInfo({});
    const unsub = botEvents.subscribe(botId, 'info', setInfo, {
      ignorePrevious: true,
      throttle: 500,
    });
    botActionHandler('infoPacket');
    return unsub;
  }, [botId]);

  return info;
}
