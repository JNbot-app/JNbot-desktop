import { FC, Suspense, useDeferredValue, useState } from 'react';
import { Skeleton } from 'antd';
import type { ActiveBotsType } from 'main/src/types';
import { BOT_SECTIONS } from 'renderer/components/bot/botSections';
import type { TabKey } from 'renderer/components/bot/types';
import BotPanelHeader from './BotPanelHeader';
import BotSectionNav from './BotSectionNav';
import './botPanel.css';

// Reopen on the section the user last looked at, across bots and panel tabs.
let lastSection: TabKey = 'chat';

const BotPanel: FC<{ selectedBot: ActiveBotsType[number] }> = ({
  selectedBot,
}) => {
  const [active, setActive] = useState<TabKey>(lastSection);
  // The nav updates instantly; the body keeps the previous section visible
  // while the next one loads/renders instead of flashing a fallback.
  const shown = useDeferredValue(active);
  const section = BOT_SECTIONS.find((s) => s.key === shown) ?? BOT_SECTIONS[0];

  const select = (key: TabKey) => {
    lastSection = key;
    setActive(key);
  };

  return (
    <div className="bot-panel">
      <BotPanelHeader bot={selectedBot} />
      <BotSectionNav
        botId={selectedBot.botId}
        active={active}
        onChange={select}
      />
      <div
        className="bot-panel-body"
        style={{ opacity: shown === active ? 1 : 0.6 }}
      >
        <Suspense fallback={<Skeleton active paragraph={{ rows: 4 }} />}>
          {section.render(selectedBot, true)}
        </Suspense>
      </div>
    </div>
  );
};

export default BotPanel;
