import React, { useState, useMemo } from 'react';
import { Tabs, Typography, theme as antTheme } from 'antd';
import { FaPlay, FaCube, FaCog } from 'react-icons/fa';
import LauncherBackground from '../components/mcLauncher/LauncherBackground';
import PlayTab from '../components/mcLauncher/tabs/PlayTab';
import VersionsTab from '../components/mcLauncher/tabs/VersionsTab';
import InstallationsTab from '../components/mcLauncher/tabs/ModInstallationsTab';
import SettingsTab from '../components/mcLauncher/tabs/SettingsTab';
import {
  useSettingsStore,
  RootState,
  setLauncherOptions,
} from '../redux/settings';
import { LaunchMinecraftOptions } from '../../main/src/types';
import { MinecraftLauncherTypes } from '../../common/CommonEnums';
import useAppApi from '../hooks/useAppApi';
import { useVersions } from '../hooks/useVersions';
import { MdExtension } from 'react-icons/md';

const McLauncher: React.FC = () => {
  const { token } = antTheme.useToken();
  const { message } = useAppApi();

  const [activeTab, setActiveTab] = useState('play');

  const launcherOptions = useSettingsStore(
    (state: RootState) =>
      state.launcherOptions ??
      ({
        username: '',
        version: '1.21.11',
        launcherFlags: MinecraftLauncherTypes.JNBOT_CLIENT,
        minMemoryMB: 512,
        maxMemoryMB: 2048,
        window: {
          fullscreen: false,
        },
        gamemode: '',
      } satisfies LaunchMinecraftOptions),
  );

  const selectedVersion = {
    id: launcherOptions?.version ?? '1.21.11',
    launcherFlags:
      launcherOptions?.launcherFlags ?? MinecraftLauncherTypes.JNBOT_CLIENT,
  };

  // Event handlers for version, account, and gamemode selection
  const updateSelectedVersion = (selection: {
    versionId: string;
    launcherFlags: number;
  }) => {
    setLauncherOptions({
      ...launcherOptions,
      version: selection.versionId,
      launcherFlags: selection.launcherFlags,
    });
  };

  const { versions, versionsLoading } = useVersions({
    selectedVersionId: selectedVersion?.id,
    selectedLauncherFlags: selectedVersion?.launcherFlags as
      | MinecraftLauncherTypes
      | undefined,
    onVersionSelect: updateSelectedVersion,
    message,
  });

  const selectedVersionData = useMemo(
    () =>
      versions.find(
        (v) =>
          v.id === selectedVersion?.id &&
          v.launcherType ===
            (selectedVersion?.launcherFlags as
              | MinecraftLauncherTypes
              | undefined),
      ),
    [versions, selectedVersion?.id, selectedVersion?.launcherFlags],
  );

  const onLauncherOptionsChange = (
    options: Partial<LaunchMinecraftOptions>,
  ) => {
    setLauncherOptions({
      ...launcherOptions,
      ...options,
    });
  };

  // Tab items using extracted components
  const tabItems = [
    {
      key: 'play',
      label: (
        <span>
          <FaPlay style={{ marginRight: 8 }} />
          Play
        </span>
      ),
      children: <PlayTab versions={versions} />,
    },
    {
      key: 'versions',
      label: (
        <span>
          <FaCube style={{ marginRight: 8 }} />
          Versions
        </span>
      ),
      children: (
        <VersionsTab
          versions={versions}
          versionsLoading={versionsLoading}
          selectedVersion={selectedVersion}
          onSelect={updateSelectedVersion}
        />
      ),
    },
    {
      key: 'installations',
      label: (
        <span>
          <MdExtension size={18} style={{ marginRight: 8 }} />
          Mods
        </span>
      ),
      children: (
        <InstallationsTab
          canManageMods={!!(launcherOptions?.username && selectedVersion?.id)}
          mcVersion={selectedVersion.id}
          loader={selectedVersion.launcherFlags}
        />
      ),
    },
    {
      key: 'settings',
      label: (
        <span>
          <FaCog style={{ marginRight: 8 }} />
          Settings
        </span>
      ),
      children: (
        <SettingsTab
          launcherOptions={launcherOptions}
          onLauncherOptionsChange={onLauncherOptionsChange}
        />
      ),
    },
  ];

  return (
    <LauncherBackground imageUrl={selectedVersionData?.backgroundImage}>
      <div
        className="mc-launcher-container"
        style={{ padding: 24, height: '100%', overflowY: 'auto' }}
      >
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          <div
            className="mc-launcher-header"
            style={{ marginBottom: 24, animation: 'fadeIn 0.6s ease-out' }}
          >
            <Typography.Title
              level={2}
              style={{
                margin: 0,
                color: token.colorTextLightSolid,
                textShadow: `2px 2px 8px ${token.colorBgMask}`,
                fontWeight: 700,
                letterSpacing: '2px',
              }}
            >
              MINECRAFT LAUNCHER{' '}
            </Typography.Title>
            <Typography.Text
              style={{
                color: token.colorTextLightSolid,
                textShadow: `1px 1px 4px ${token.colorBgMask}`,
                fontSize: 14,
                letterSpacing: '1px',
                opacity: 0.9,
              }}
            >
              Java Edition
            </Typography.Text>
          </div>

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            size="large"
            style={{
              backgroundColor: 'transparent',
            }}
            tabBarStyle={{
              backgroundColor: `${token.colorBgContainer}dd`,
              backdropFilter: 'blur(10px)',
              padding: '0 16px',
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              marginBottom: 24,
            }}
          />
        </div>
      </div>
    </LauncherBackground>
  );
};

export default McLauncher;
