import { FC } from 'react';
import { Badge, Segmented } from 'antd';
import {
  BOT_SECTIONS,
  useUnreadChat,
} from 'renderer/components/bot/botSections';
import type { TabKey } from 'renderer/components/bot/types';

/** Icon-only when narrow; labels appear once the panel is wide enough (see botPanel.css). */
const BotSectionNav: FC<{
  botId: number;
  active: TabKey;
  onChange: (key: TabKey) => void;
}> = ({ botId, active, onChange }) => {
  const unreadChat = useUnreadChat(botId, active === 'chat');

  return (
    <div className="bot-panel-nav">
      <Segmented<TabKey>
        block
        value={active}
        onChange={onChange}
        options={BOT_SECTIONS.map(({ key, label, icon }) => ({
          value: key,
          tooltip: label,
          label: (
            <span className="bot-panel-nav-item">
              {key === 'chat' ? (
                <Badge dot={unreadChat > 0} offset={[2, 0]}>
                  {icon}
                </Badge>
              ) : (
                icon
              )}
              <span className="bot-panel-nav-label">{label}</span>
            </span>
          ),
        }))}
      />
    </div>
  );
};

export default BotSectionNav;
