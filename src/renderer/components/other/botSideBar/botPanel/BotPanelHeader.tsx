import { FC } from 'react';
import { Button, Dropdown, Flex, Skeleton, Tooltip, Typography } from 'antd';
import {
  CloseOutlined,
  LogoutOutlined,
  MoreOutlined,
  RightCircleOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { FaRegCircleStop } from "react-icons/fa6";

import type { ActiveBotsType } from 'main/src/types';
import Image from 'renderer/components/Image';
import botActionHandler from 'renderer/components/bot/botActionHandler';
import { selectScripts, useSettingsStore } from 'renderer/redux/settings';

const MENU_ITEMS = [
  { key: 'login', icon: <UnlockOutlined />, label: 'Enter password' },
  { key: 'activateItem', icon: <RightCircleOutlined />, label: 'Right-click item' },
  { key: 'closeWindow', icon: <CloseOutlined />, label: 'Close window' },
];

const BotPanelHeader: FC<{ bot: ActiveBotsType[number] }> = ({ bot }) => {
  const scripts = useSettingsStore(selectScripts);
  const subtitle = [bot.SCRIPT_NAME, bot.host].filter(Boolean).join(' · ');

  return (
    <Flex vertical gap={10} style={{ flexShrink: 0 }}>
      <Flex align="center" gap={10}>
        <Image
          width={36}
          height={36}
          style={{ borderRadius: 6, flexShrink: 0 }}
          loadingElement={<Skeleton.Avatar active shape="square" size={36} />}
          src={`https://crafthead.net/avatar/${bot.username || 'steve'}?size=72&default=MHF_Steve`}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong ellipsis style={{ display: 'block' }}>
            {bot.username}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            ellipsis={{ tooltip: subtitle }}
            style={{ display: 'block', fontSize: 12 }}
          >
            {subtitle}
          </Typography.Text>
        </div>
        <Flex gap={2} style={{ flexShrink: 0 }}>
          <Tooltip title="Stop script">
            <Button
              type="text"
              icon={<FaRegCircleStop />}
              aria-label="Stop script"
              onClick={() => scripts.stop(bot.RUNTIME_SCRIPT_ID ?? bot.botId)}
            />
          </Tooltip>
          <Tooltip title="Leave server">
            <Button
              type="text"
              danger
              icon={<LogoutOutlined />}
              aria-label="Leave server"
              onClick={() => botActionHandler('leave')}
            />
          </Tooltip>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: MENU_ITEMS,
              onClick: ({ key }) => botActionHandler(key),
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label="More actions" />
          </Dropdown>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default BotPanelHeader;
