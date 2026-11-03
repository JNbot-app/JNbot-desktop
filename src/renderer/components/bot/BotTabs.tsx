import React, { Suspense, useState } from 'react';
import { Badge, Menu, Skeleton, theme as antTheme } from 'antd';
import BotHeader from './BotHeader';
import { BOT_SECTIONS, useUnreadChat } from './botSections';
import { BotInfo, TabKey } from './types';

interface BotTabsProps {
  selectedBot: BotInfo | null;
}

const BotTabs: React.FC<BotTabsProps> = ({ selectedBot }) => {
  const [activeTabKey, setActiveTabKey] = useState<TabKey>('chat');

  if (!selectedBot) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          flexDirection: 'column',
        }}
      >
        <img
          style={{ width: 280, opacity: 0.08 }}
          src="data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTE3Ljc1MyAxNGEyLjI1IDIuMjUgMCAwIDEgMi4yNSAyLjI1di45MDVhMy43NSAzLjc1IDAgMCAxLTEuMzA3IDIuODQ2QzE3LjEzIDIxLjM0NSAxNC44OSAyMiAxMiAyMmMtMi44OSAwLTUuMTI4LS42NTYtNi42OTEtMmEzLjc1IDMuNzUgMCAwIDEtMS4zMDYtMi44NDN2LS45MDhBMi4yNSAyLjI1IDAgMCAxIDYuMjUzIDE0aDExLjVabTAgMS41aC0xMS41YS43NS43NSAwIDAgMC0uNzUuNzV2LjkwOGMwIC42NTUuMjg2IDEuMjc4Ljc4NCAxLjcwNkM3LjU0NSAxOS45NDUgOS40NCAyMC41MDIgMTIgMjAuNTAyYzIuNTYgMCA0LjQ1OC0uNTU3IDUuNzE5LTEuNjRhMi4yNSAyLjI1IDAgMCAwIC43ODQtMS43MDZ2LS45MDZhLjc1Ljc1IDAgMCAwLS43NS0uNzVaTTExLjg5OCAyLjAwOCAxMiAyYS43NS43NSAwIDAgMSAuNzQzLjY0OGwuMDA3LjEwMlYzLjVoMy41YTIuMjUgMi4yNSAwIDAgMSAyLjI1IDIuMjV2NC41MDVhMi4yNSAyLjI1IDAgMCAxLTIuMjUgMi4yNWgtOC41YTIuMjUgMi4yNSAwIDAgMS0yLjI1LTIuMjVWNS43NUEyLjI1IDIuMjUgMCAwIDEgNy43NSAzLjVoMy41di0uNzQ5YS43NS43NSAwIDAgMSAuNjQ4LS43NDNMMTIgMmwtLjEwMi4wMDdaTTE2LjI1IDVoLTguNWEuNzUuNzUgMCAwIDAtLjc1Ljc1djQuNTA1YzAgLjQxNC4zMzYuNzUuNzUuNzVoOC41YS43NS43NSAwIDAgMCAuNzUtLjc1VjUuNzVhLjc1Ljc1IDAgMCAwLS43NS0uNzVabS02LjUgMS41YTEuMjUgMS4yNSAwIDEgMSAwIDIuNSAxLjI1IDEuMjUgMCAwIDEgMC0yLjVabTQuNDkyIDBhMS4yNSAxLjI1IDAgMSAxIDAgMi40OTkgMS4yNSAxLjI1IDAgMCAxIDAtMi40OTlaIiBmaWxsPSIjNWI3MDhjIiBjbGFzcz0iZmlsbC0yMTIxMjEiPjwvcGF0aD48L3N2Zz4="
          alt="No bot selected"
        />
      </div>
    );
  }

  const section = BOT_SECTIONS.find((s) => s.key === activeTabKey);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <BotHeader selectedBot={selectedBot} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <BotTabsMenu
          botId={selectedBot.botId}
          active={activeTabKey}
          onChange={setActiveTabKey}
        />
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 20 }}>
          <Suspense fallback={<Skeleton active />}>
            {section?.render(selectedBot)}
          </Suspense>
        </div>
      </div>
    </div>
  );
};

/** Owns the unread counter so chat traffic only re-renders the menu. */
const BotTabsMenu: React.FC<{
  botId: number;
  active: TabKey;
  onChange: (key: TabKey) => void;
}> = ({ botId, active, onChange }) => {
  const { token } = antTheme.useToken();
  const unreadChat = useUnreadChat(botId, active === 'chat');

  return (
    <div
      style={{
        width: 160,
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        padding: '12px 8px',
        flexShrink: 0,
      }}
    >
      <Menu
        mode="inline"
        selectedKeys={[active]}
        onClick={(e) => onChange(e.key as TabKey)}
        items={BOT_SECTIONS.map(({ key, icon, label }) => ({
          key,
          icon,
          label:
            key === 'chat' ? <TabLabel text={label} badge={unreadChat} /> : label,
        }))}
        style={{ background: 'transparent', borderInlineEnd: 'none' }}
      />
    </div>
  );
};

const TabLabel: React.FC<{ text: string; badge?: number }> = ({ text, badge }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
    <span>{text}</span>
    {badge ? <Badge count={badge} size="small" style={{ marginInlineStart: 8 }} /> : null}
  </span>
);

export default BotTabs;
