import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Col, Flex, Row, theme } from 'antd';
import {
  useSettingsStore,
  selectSettings,
  selectScripts,
  updateScriptSettings,
} from '../redux/settings';
import useAppApi from '../hooks/useAppApi';
import type { ActivityEvent, DiscordStats } from '../components/discord/types';
import DiscordHeader from '../components/discord/DiscordHeader';
import DiscordAuthCard from '../components/discord/DiscordAuthCard';
import DiscordStatsGrid from '../components/discord/DiscordStatsGrid';
import DiscordRoleManager from '../components/discord/DiscordRoleManager';
import DiscordActivityFeed from '../components/discord/DiscordActivityFeed';
import DiscordCommandsGrid from '../components/discord/DiscordCommandsGrid';

const MAX_ACTIVITY = 60;

const Discord: React.FC = () => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const settings = useSettingsStore(selectSettings);
  const scripts = useSettingsStore(selectScripts);
  const isActive = scripts.isScriptActiveByName('discordBot');

  const discord = settings.scripts?.discord ?? {};
  const savedToken: string = discord.token ?? '';
  const savedRoles: string[] = discord.roles ?? [];
  const blockedRoles: string[] = discord.blockedRoles ?? [];

  const [stats, setStats] = useState<DiscordStats>({ online: false });
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const offStats = window.ipcRenderer.on(
      'DISCORD_STATS',
      (s: DiscordStats) => {
        setStats(s);
      },
    );
    const offActivity = window.ipcRenderer.on(
      'DISCORD_ACTIVITY',
      (event: ActivityEvent) => {
        setActivity((prev) => [event, ...prev].slice(0, MAX_ACTIVITY));
      },
    );
    return () => {
      offStats?.();
      offActivity?.();
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      setStats({ online: false });
    }
  }, [isActive]);

  const onSaveToken = useCallback((value: string) => {
    updateScriptSettings({
      scriptName: 'discord',
      optionId: 'token',
      value,
    });
    message.success(value ? 'Token saved' : 'Token cleared');
  }, [message]);

  const toggleBot = useCallback(async () => {
    if (isActive) {
      scripts.stopAll('discordBot');
      return;
    }
    if (!savedToken.trim()) {
      message.error('Configure a bot token first');
      return;
    }
    setIsLoading(true);
    try {
      await scripts.startScript({ script: 'discordBot' });
    } catch {
      message.error('Failed to start bot');
    } finally {
      setIsLoading(false);
    }
  }, [isActive, savedToken, scripts, message]);

  const inviteUrl = useMemo(() => {
    const appId = stats.online ? stats.applicationId : null;
    return appId
      ? `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=2147485696`
      : null;
  }, [stats]);

  return (
    <Flex vertical gap={token.marginLG}>
      <DiscordHeader
        isActive={isActive}
        isLoading={isLoading}
        stats={stats}
        inviteUrl={inviteUrl}
        onToggleBot={toggleBot}
      />

      <DiscordAuthCard savedToken={savedToken} onSaveToken={onSaveToken} />

      <DiscordStatsGrid stats={stats} />

      <Row gutter={[token.marginMD, token.marginMD]}>
        <Col xs={24} lg={12}>
          <DiscordRoleManager
            savedRoles={savedRoles}
            blockedRoles={blockedRoles}
          />
        </Col>
        <Col xs={24} lg={12}>
          <DiscordActivityFeed
            activity={activity}
            onClear={() => {
              setActivity([]);
              message.success('Activity cleared');
            }}
          />
        </Col>
      </Row>

      <DiscordCommandsGrid />
    </Flex>
  );
};

export default Discord;
