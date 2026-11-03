import { lazy, useEffect, useState, type ReactNode } from 'react';
import {
  AimOutlined,
  AppstoreOutlined,
  BellOutlined,
  CodeOutlined,
  EnvironmentOutlined,
  InfoCircleOutlined,
  MessageOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import botEvents from '../../utils/botEvents';
import type { BotInfo, ChatData, TabKey } from './types';

// Sections are code-split so only the one being viewed is ever loaded.
const Chat = lazy(() => import('./tabs/Chat'));
const Actions = lazy(() => import('./tabs/Actions'));
const Inventory = lazy(() => import('./tabs/Inventory'));
const Movement = lazy(() => import('./tabs/Movement'));
const BotMap = lazy(() => import('./tabs/map/BotMap'));
const Code = lazy(() => import('./tabs/Code'));
const Triggers = lazy(() => import('./tabs/Triggers'));
const Info = lazy(() => import('./tabs/Info'));

export interface BotSection {
  key: TabKey;
  label: string;
  icon: ReactNode;
  render: (bot: BotInfo, small?: boolean) => ReactNode;
}

export const BOT_SECTIONS: BotSection[] = [
  {
    key: 'chat',
    label: 'Chat',
    icon: <MessageOutlined />,
    render: (bot, small) => <Chat selectedBot={bot} small={small} />,
  },
  {
    key: 'actions',
    label: 'Actions',
    icon: <ThunderboltOutlined />,
    render: (bot, small) => <Actions bot={bot} small={small} />,
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: <AppstoreOutlined />,
    render: (bot) => <Inventory selectedBot={bot} />,
  },
  {
    key: 'movement',
    label: 'Movement',
    icon: <AimOutlined />,
    render: (bot) => <Movement selectedBot={bot} />,
  },
  {
    key: 'map',
    label: 'Map',
    icon: <EnvironmentOutlined />,
    render: (bot, small) => <BotMap bot={bot} small={small} />,
  },
  {
    key: 'code',
    label: 'Code',
    icon: <CodeOutlined />,
    render: (bot, small) => <Code selectedBot={bot} small={small} />,
  },
  {
    key: 'triggers',
    label: 'Triggers',
    icon: <BellOutlined />,
    render: (bot, small) => <Triggers selectedBot={bot} small={small} />,
  },
  {
    key: 'info',
    label: 'Info',
    icon: <InfoCircleOutlined />,
    render: (bot, small) => <Info selectedBot={bot} small={small} />,
  },
];

/** Counts incoming chat messages while the chat section is not open. */
export function useUnreadChat(botId: number, chatOpen: boolean) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setUnread(0);
    if (chatOpen) return undefined;
    return botEvents.subscribe(
      botId,
      'chat',
      (msg: ChatData) => {
        if ('message' in msg) setUnread((c) => c + 1);
      },
      { throttle: 100 },
    );
  }, [botId, chatOpen]);

  return unread;
}
