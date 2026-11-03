import React, { useMemo } from 'react';
import {
  Card,
  Space,
  Typography,
  theme as antTheme,
  Empty,
  Flex,
  Badge,
  Avatar,
  Divider,
  Button,
} from 'antd';
import {
  RocketOutlined,
  UserOutlined,
  DesktopOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import {
  useSettingsStore,
  RootState,
  selectActiveBots,
  selectScripts,
} from '../../../redux/settings';
import FeaturedVersionCard from '../FeaturedVersionCard';
import PlayMcCard from '../PlayMcCard';
import LaunchLogsModal from '../LaunchLogsModal';
import { useLaunchDiagnostics } from '../../../hooks/useLaunchDiagnostics';
import type { VersionItem } from '../VersionBrowser';
import { MinecraftLauncherTypes } from '../../../../common/CommonEnums';

interface PlayTabProps {
  versions: VersionItem[];
}

const PlayTab: React.FC<PlayTabProps> = ({ versions }) => {
  const { token } = antTheme.useToken();
  const {
    colorBgContainer,
    colorBorderSecondary,
    colorTextLightSolid,
    colorBgMask,
    borderRadius,
  } = token;

  const activeBots = useSettingsStore(selectActiveBots);
  const scriptsService = useSettingsStore(selectScripts);
  const activeScripts = Object.values(scriptsService.raw);

  const launcherOptions = useSettingsStore(
    (state: RootState) =>
      state.launcherOptions ?? {
        version: '1.21.11',
        launcherFlags: MinecraftLauncherTypes.JNBOT_CLIENT,
      },
  );

  const selectedVersion = {
    id: launcherOptions.version ?? '1.21.11',
    launcherFlags:
      launcherOptions.launcherFlags ?? MinecraftLauncherTypes.JNBOT_CLIENT,
  };

  const selectedVersionData = useMemo(
    () =>
      versions.find(
        (v) =>
          v.id === selectedVersion?.id &&
          v.launcherType === selectedVersion?.launcherFlags,
      ),
    [versions, selectedVersion?.id, selectedVersion?.launcherFlags],
  );

  const minecraftSessionsGrouped = React.useMemo(() => {
    const mcScripts = activeScripts.filter(
      (script) => script.origin === 'minecraft',
    );
    const mcBots = activeBots.filter((bot) => bot.origin === 'minecraft');

    return mcScripts.map((script) => {
      const sessionBots = mcBots.filter(
        (bot) => bot.SCRIPT_ID === script.scriptId,
      );

      return {
        id: script.instanceId,
        bridgeInstanceId: script.minecraft?.instanceId,
        name: script.name,
        version: script.minecraft?.requestedVersion || 'N/A',
        status: script.minecraft?.status || 'Running',
        stage: script.minecraft?.stage,
        clients: sessionBots.map((bot) => ({
          id: String(bot.botId),
          username: bot.username,
          uid: bot.UID,
          status: bot.status,
          scriptName: bot.SCRIPT_NAME,
        })),
      };
    });
  }, [activeBots, activeScripts]);

  const {
    logsSnapshot,
    isLogsOpen,
    openDiagnostics,
    closeDiagnostics,
    clearDiagnostics,
  } = useLaunchDiagnostics();

  return (
    <Space orientation="vertical" size={24} style={{ width: '100%' }}>
      <div
        className="mc-launcher-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 24,
          alignItems: 'start',
        }}
      >
          <FeaturedVersionCard
            version={selectedVersionData}
            colorBgContainer={colorBgContainer}
            colorBorderSecondary={colorBorderSecondary}
            colorTextLightSolid={colorTextLightSolid}
            colorBgMask={colorBgMask}
          />

          <PlayMcCard />
      </div>

      {/* Active Minecraft Sessions */}
      <Card
        style={{
          backgroundColor: colorBgContainer,
          border: `1px solid ${colorBorderSecondary}`,
          borderRadius,
        }}
      >
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Flex justify="space-between" align="center">
            <Typography.Title level={5} style={{ margin: 0 }}>
              <RocketOutlined style={{ marginRight: 8 }} />
              Active Minecraft Sessions
            </Typography.Title>
            <Button
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => {
                openDiagnostics();
              }}
            >
              Launch diagnostics
            </Button>
          </Flex>

          {minecraftSessionsGrouped.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Typography.Text type="secondary">
                  No active Minecraft instances running
                </Typography.Text>
              }
              style={{ padding: '24px 0' }}
            />
          ) : (
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              {minecraftSessionsGrouped.map((session) => (
                <Card
                  key={session.id}
                  size="small"
                  style={{
                    backgroundColor: colorBgContainer,
                    border: `1px solid ${colorBorderSecondary}`,
                    borderRadius,
                  }}
                >
                  {/* Session Header */}
                  <Flex
                    justify="space-between"
                    align="center"
                    style={{
                      marginBottom: session.clients.length > 0 ? 12 : 0,
                    }}
                  >
                    <Space size={12}>
                      <DesktopOutlined
                        style={{ fontSize: 20, color: token.colorPrimary }}
                      />
                      <Space orientation="vertical" size={2}>
                        <Typography.Text strong style={{ fontSize: 15 }}>
                          {session.name}
                        </Typography.Text>
                        <Space
                          size={16}
                          separator={
                            <Divider orientation="vertical" style={{ margin: 0 }} />
                          }
                        >
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            v{session.version}
                          </Typography.Text>
                          {session.stage && (
                            <Typography.Text
                              type="secondary"
                              style={{ fontSize: 12 }}
                            >
                              {session.stage}
                            </Typography.Text>
                          )}
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            {session.status}
                          </Typography.Text>
                        </Space>
                      </Space>
                    </Space>
                    <Button
                      size="small"
                      type="text"
                      icon={<FileTextOutlined />}
                      onClick={() => {
                        openDiagnostics(
                          session.bridgeInstanceId ?? session.id,
                        );
                      }}
                    >
                      Diagnostics
                    </Button>
                  </Flex>

                  {/* Connected Clients */}
                  {session.clients.length > 0 && (
                    <>
                      <Divider style={{ margin: '8px 0' }} />
                      <div
                        style={{
                          paddingLeft: 32,
                          backgroundColor: `${colorBorderSecondary}33`,
                          borderRadius: borderRadius,
                          padding: 12,
                        }}
                      >
                        <Typography.Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            fontWeight: 600,
                            marginBottom: 8,
                            display: 'block',
                          }}
                        >
                          Connected Clients ({session.clients.length})
                        </Typography.Text>
                        <Space
                          orientation="vertical"
                          size={8}
                          style={{ width: '100%' }}
                        >
                          {session.clients.map((client) => (
                            <Flex key={client.id} align="center" gap={12}>
                              <Avatar
                                size={32}
                                shape="square"
                                src={
                                  'https://crafthead.net/avatar/' +
                                  client.username
                                }
                                icon={!client.uid && <UserOutlined />}
                                style={{ flexShrink: 0 }}
                              />
                              <Space
                                orientation="vertical"
                                size={0}
                                style={{ flex: 1 }}
                              >
                                <Typography.Text
                                  strong
                                  style={{ fontSize: 13 }}
                                >
                                  {client.username}
                                </Typography.Text>
                                <Space size={8}>
                                  <Badge
                                    status={
                                      client.status === 'connected'
                                        ? 'success'
                                        : 'default'
                                    }
                                    text={
                                      <Typography.Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        {client.status}
                                      </Typography.Text>
                                    }
                                  />
                                  {client.scriptName && (
                                    <Typography.Text
                                      type="secondary"
                                      style={{ fontSize: 11 }}
                                    >
                                      • {client.scriptName}
                                    </Typography.Text>
                                  )}
                                </Space>
                              </Space>
                            </Flex>
                          ))}
                        </Space>
                      </div>
                    </>
                  )}
                </Card>
              ))}
            </Space>
          )}
        </Space>
      </Card>
      <LaunchLogsModal
        open={isLogsOpen}
        onClose={closeDiagnostics}
        snapshot={logsSnapshot}
        onClear={clearDiagnostics}
      />
    </Space>
  );
};

export default PlayTab;
