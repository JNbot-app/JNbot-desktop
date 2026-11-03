import React from 'react';
import Card from '../Card';
import { ActiveBotsList } from '../bot/activeBotList';

const ActiveBots: React.FC = () => {
  return (
    <Card
      title="Online bots"
      icon={
        <svg
          width="25px"
          height="25px"
          fill="currentColor"
          viewBox="0 0 24 24"
          x="0px"
          y="0px"
        >
          <path d="m 19,17 a 0.93,0.93 0 0 1 -0.45,-0.11 l -4,-2 a 1,1 0 1 1 0.9,-1.78 l 4,2 A 1,1 0 0 1 19.89,16.45 1,1 0 0 1 19,17 Z M 5,17 A 1,1 0 0 1 4.11,16.45 1,1 0 0 1 4.55,15.11 l 4,-2 a 1,1 0 1 1 0.9,1.78 l -4,2 A 0.93,0.93 0 0 1 5,17 Z m 10,2 H 9 A 1,1 0 0 1 8,18 v -6 a 1,1 0 0 1 1,-1 h 6 a 1,1 0 0 1 1,1 v 6 a 1,1 0 0 1 -1,1 z m -5,-2 h 4 v -4 h -4 z m 5,5 a 1,1 0 0 1 -1,-1 v -3 a 1,1 0 0 1 2,0 v 3 a 1,1 0 0 1 -1,1 z M 9,22 A 1,1 0 0 1 8,21 v -3 a 1,1 0 0 1 2,0 v 3 A 1,1 0 0 1 9,22 Z M 12,4 A 1,1 0 0 1 11,3 V 2 a 1,1 0 0 1 2,0 v 1 a 1,1 0 0 1 -1,1 z m 2,5 A 1,1 0 0 1 13.29,7.29 1.0040916,1.0040916 0 0 1 14.71,8.71 1,1 0 0 1 14.55,8.83 0.56,0.56 0 0 1 14.38,8.92 0.6,0.6 0 0 1 14.19,8.98 Z M 10,9 A 1.05,1.05 0 0 1 9.29,8.71 1,1 0 0 1 10.19,7 a 0.6,0.6 0 0 1 0.19,0.06 0.56,0.56 0 0 1 0.17,0.09 l 0.16,0.12 A 1,1 0 0 1 10,9 Z m 6,4 H 8 A 3,3 0 0 1 5,10 V 6 A 3,3 0 0 1 8,3 h 8 a 3,3 0 0 1 3,3 v 4 a 3,3 0 0 1 -3,3 z M 8,5 A 1,1 0 0 0 7,6 v 4 a 1,1 0 0 0 1,1 h 8 a 1,1 0 0 0 1,-1 V 6 A 1,1 0 0 0 16,5 Z" />
        </svg>
      }
      style={{ height: '100%', minHeight: '350px' }}
    >
      <ActiveBotsList />
    </Card>
  );
};

export default ActiveBots;
