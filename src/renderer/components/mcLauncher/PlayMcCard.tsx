import React, { useMemo, useEffect } from 'react';
import {
  Card,
  Select,
  Space,
  Typography,
  Button,
  theme as antTheme,
} from 'antd';
import {
  useSettingsStore,
  RootState,
  selectJNDataByServer,
  setLauncherOptions,
} from '../../redux/settings';
import AccountSelector from './AccountSelector';
import PlayButton from './PlayButton';
import LaunchLogsModal from './LaunchLogsModal';
import LaunchStatusPanel from './LaunchStatusPanel';
import CrashReportModal from './CrashReportModal';
import type {
  Gamemode,
  LaunchMinecraftOptions,
  AltWithData,
} from '../../../main/src/types';
import { useMinecraftLauncher } from '../../hooks/useMinecraftLauncher';
import { MinecraftLauncherTypes } from '../../../common/CommonEnums';
import useAppApi from '../../hooks/useAppApi';

const PlayMcCard: React.FC = () => {
  const { token } = antTheme.useToken();
  const { colorBgContainer, colorBorderSecondary, borderRadius } = token;
  const { message } = useAppApi();

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

  const selectedAccount = launcherOptions?.username || '';
  const selectedGamemode = launcherOptions?.gamemode || null;
  const selectedVersion = {
    id: launcherOptions?.version ?? '1.21.11',
    launcherFlags:
      launcherOptions?.launcherFlags ?? MinecraftLauncherTypes.JNBOT_CLIENT,
  };
  const canPlay = !!(selectedAccount && selectedVersion?.id);

  const JNbotData = useSettingsStore(selectJNDataByServer);
  const gamemodes = JNbotData.data.gamemodes;

  const alts = useSettingsStore((state) => state.alts);

  const accounts = useMemo(
    () =>
      alts.map((alt: AltWithData) => {
        const uuid = alt.UID ?? undefined;
        const avatarUrl = uuid
          ? `https://mc-heads.net/avatar/${uuid}/32`
          : undefined;
        return {
          username: alt.username,
          premium: alt.data?.premium || false,
          avatarUrl,
        };
      }),
    [alts],
  );

  const updateSelectedAccount = (account: string) => {
    setLauncherOptions({
      ...launcherOptions,
      username: account,
    });
  };

  const updateSelectedGamemode = (gamemode: Gamemode) => {
    setLauncherOptions({
      ...launcherOptions,
      gamemode,
    });
  };

  const {
    launchState,
    isLaunching,
    logsSnapshot,
    isLogsOpen,
    openLogs,
    closeLogs,
    isCrashReportOpen,
    openCrashReport,
    closeCrashReport,
    handlePlay,
    clearLogs,
  } = useMinecraftLauncher({
    selectedAccount,
    selectedVersion,
    selectedGamemode,
    minecraftDirectory: launcherOptions?.minecraftDirectory || '',
    message,
  });

  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      updateSelectedAccount(accounts[0].username);
    }
  }, [accounts, selectedAccount]);

  return (
    <>
      <Card
        style={{
          backgroundColor: colorBgContainer,
          border: `1px solid ${colorBorderSecondary}`,
          borderRadius,
        }}
        styles={{
          body: { padding: 24, height: '100%' },
        }}
      >
        <Space orientation="vertical" style={{ width: '100%' }} size="large">
          <div>
            <Typography.Title
              level={4}
              className="mc-launcher-title"
              style={{
                marginTop: 0,
                marginBottom: 16,
                letterSpacing: '0.5px',
              }}
            >
              Play Minecraft
            </Typography.Title>
            <AccountSelector
              accounts={accounts}
              selectedAccount={selectedAccount}
              onSelect={updateSelectedAccount}
            />
            <br />
            <div>
              <Typography.Text
                strong
                style={{ display: 'block', marginBottom: 8, fontSize: 14 }}
              >
                Gamemode
              </Typography.Text>
              <Select
                value={selectedGamemode}
                onChange={updateSelectedGamemode}
                style={{ width: '100%' }}
                allowClear
                size="large"
                placeholder="Select gamemode"
                options={gamemodes.map((gm) => ({
                  label: gm,
                  value: gm,
                }))}
              />
            </div>
          </div>

          <div>
            <PlayButton
              onClick={handlePlay}
              disabled={!canPlay}
              loading={isLaunching}
            />
            {launchState.kind !== 'idle' && (
              <div style={{ marginTop: token.marginSM }}>
                <LaunchStatusPanel
                  state={launchState}
                  onOpenLogs={openLogs}
                  onOpenCrashReport={openCrashReport}
                />
              </div>
            )}
          </div>
        </Space>
      </Card>
      <LaunchLogsModal
        open={isLogsOpen}
        onClose={closeLogs}
        snapshot={logsSnapshot}
        onClear={clearLogs}
      />
      <CrashReportModal
        open={isCrashReportOpen}
        crashInfo={
          launchState.kind === 'failed' ? launchState.crashInfo ?? null : null
        }
        onClose={closeCrashReport}
      />
    </>
  );
};

export default PlayMcCard;
