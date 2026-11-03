import React from 'react';
import {
  BellOutlined,
  CommentOutlined,
  DisconnectOutlined,
  EyeOutlined,
  FileTextOutlined,
  GiftOutlined,
  InboxOutlined,
  HeartOutlined,
  LoginOutlined,
  LogoutOutlined,
  MessageOutlined,
  PlayCircleOutlined,
  SendOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import type {
  Trigger,
  TriggerActionType,
  TriggerEvent,
} from '../../../common/triggers';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import {
  TRIGGER_TAB,
  type TriggerPanelData,
} from '../other/botSideBar/panelTabs';

export const TRIGGER_EVENT_ICONS: Record<TriggerEvent, React.ReactNode> = {
  chat: <CommentOutlined />,
  join: <WifiOutlined />,
  disconnect: <DisconnectOutlined />,
  kicked: <LogoutOutlined />,
  death: <LoginOutlined rotate={90} />,
  lowHealth: <HeartOutlined />,
  playerNearby: <EyeOutlined />,
  playerJoined: <UserAddOutlined />,
  playerLeft: <UserDeleteOutlined />,
  inventoryFull: <InboxOutlined />,
  itemReceived: <GiftOutlined />,
};

export const TRIGGER_ACTION_ICONS: Record<TriggerActionType, React.ReactNode> =
  {
    notification: <BellOutlined />,
    discord: <SendOutlined />,
    chat: <MessageOutlined />,
    scriptAction: <PlayCircleOutlined />,
    log: <FileTextOutlined />,
  };

/** Opens the trigger editor in the side panel. */
export const useOpenTrigger = () => {
  const { setPanel } = usePanelContext();
  return (trigger?: Trigger) =>
    setPanel({
      active: true,
      tab: TRIGGER_TAB,
      data: { trigger } satisfies TriggerPanelData,
    });
};
