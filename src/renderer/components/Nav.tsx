import React, { useState, useRef } from 'react';
import { Dropdown, Button, MenuProps, Space, theme as antTheme } from 'antd';
import {
  MoreOutlined,
  FileSearchOutlined,
  AlertOutlined,
  BugOutlined,
  CodeOutlined,
  MobileOutlined,
} from '@ant-design/icons';
import BugReport from './other/ReportBug';
import { CHANGELOG_TAB } from './other/botSideBar/panelTabs';
import UpdateApp from './other/UpdateApp';
import Notifications from './other/Notifications';
import ServerStatus from './other/dialogs/ServerStatus';
import { FaDiscord } from 'react-icons/fa';
import { AiOutlineDiscord } from 'react-icons/ai';
import { usePanelContext } from './other/botSideBar/SidePanelContextProvider';
import { VscLayoutSidebarRightOff } from 'react-icons/vsc';
import DropboxStorageIndicator from './other/DropboxStorageIndicator';

const Nav: React.FC = () => {
  const [openDialog, setOpenDialog] = useState<null | number>(null);
  const serverStatusRef = useRef<any>(null);
  const sidePanel = usePanelContext();

  const {
    token: { colorBgContainer, colorBorderSecondary },
  } = antTheme.useToken();

  const toggleBugReport = () => {
    setOpenDialog((c) => (c ? null : 1));
  };

  const openTerminal = async () => {
    if (sidePanel.panel.active && sidePanel.panel.tab === 'logs') {
      sidePanel.setPanel({ active: false, tab: 'logs' });
    } else {
      sidePanel.setPanel({ active: true, tab: 'logs' });
    }
  };

  const exitApp = () => {
    if (window.web) {
      localStorage.removeItem('token');
      localStorage.removeItem('id');
      location.reload();
    } else {
      window.ipcRenderer.action('EXIT_APP');
    }
  };

  const openChangelog = () => {
    sidePanel.setPanel({ active: true, tab: CHANGELOG_TAB });
  };

  const openServerStatus = () => {
    serverStatusRef.current.open();
  };
  const items: MenuProps['items'] = [
    {
      key: 'terminal',
      label: 'Open logs',
      icon: <CodeOutlined />,
      onClick: openTerminal,
    },
    {
      key: 'changelog',
      label: 'Changelog',
      icon: <FileSearchOutlined />,
      onClick: openChangelog,
    },
    // {
    //   key: 'tutorial',
    //   label: 'Tutorial',
    //   icon: <QuestionCircleOutlined />,
    //   onClick: openTutorial,
    // },
    // {
    //   key: 'suggestion',
    //   label: 'Suggestion',
    //   icon: <BulbOutlined />,
    //   onClick: openSuggestion,
    // },
    {
      key: 'bugReport',
      label: 'Report bug',
      onClick: toggleBugReport,
      icon: <BugOutlined />,
    },
    {
      key: 'mobile',
      label: (
        <a
          href="https://play.google.com/store/apps/details?id=com.jnbot.app"
          target={window.web ? '_blank' : undefined}
          rel="noopener noreferrer"
        >
          JNbot mobile
        </a>
      ),
      icon: <MobileOutlined />,
    },
    {
      key: 'discord',
      label: 'Join our Discord',
      onClick: () => {
        window.location.href = 'https://discord.gg/JNbGgypERe';
      },
      icon: <AiOutlineDiscord size={14} />,
    },
    {
      key: 'serverStatus',
      label: 'Server status',
      onClick: openServerStatus,
      icon: <AlertOutlined />,
    },
    {
      key: 'exit',
      label: window.web ? 'Logout' : 'Exit app',
      onClick: exitApp,
    },
  ];

  return (
    <Space className="no-drag">
      <DropboxStorageIndicator />
      <Button
        shape="circle"
        variant="text"
        icon={<FaDiscord />}
        href="https://discord.gg/JNbGgypERe"
      />

      <UpdateApp />

      <Space
        style={{
          background: colorBgContainer,
          border: '1px solid',
          borderColor: colorBorderSecondary,
          borderRadius: '16px',
          height: '32px',
        }}
      >
        <Notifications />
        <Dropdown menu={{ items }} trigger={['click']}>
          <Button
            icon={<MoreOutlined />}
            type="text"
            shape="circle"
            aria-label="More options"
            style={{ margin: 0 }}
          />
        </Dropdown>
      </Space>

      <Button
        className="rounded-button"
        shape="circle"
        icon={<VscLayoutSidebarRightOff />}
        style={{
          marginLeft: 'auto',
        }}
        onClick={() => openTerminal()}
      />

      <ServerStatus ref={serverStatusRef} />
      <BugReport open={openDialog} toggle={toggleBugReport} />
    </Space>
  );
};

export default Nav;
