import { FC } from 'react';
import JoinServer from '../../../bot/JoinServer';
import {
  useSettingsStore,
  selectSelectedBot,
  setSelectedBot,
} from '../../../../redux/settings';
import type { ActiveBotsType } from 'main/src/types';
import { ActiveBotsList } from '../../../bot/activeBotList';

const ActiveBotsTab: FC<{
  onSelect: (bot: ActiveBotsType[number]) => void;
}> = ({ onSelect }) => {
  const selectedBot = useSettingsStore(selectSelectedBot);

  const handleSelect = (bot: ActiveBotsType[number]) => {
    if (bot.origin === 'minecraft') return;
    setSelectedBot(bot);
    onSelect(bot);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        height: '100%',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <ActiveBotsList
          selectedBotId={selectedBot?.botId}
          onSelectBot={handleSelect}
          compact
        />
      </div>

      <JoinServer />
    </div>
  );
};

export default ActiveBotsTab;
