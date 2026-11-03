import React, { useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Divider,
  Flex,
  Popconfirm,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  BugOutlined,
  EyeOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  RocketOutlined,
  SwapOutlined,
  SyncOutlined,
  UserOutlined,
} from '@ant-design/icons';
import useAppApi from '../../hooks/useAppApi';
import type { LaunchMinecraftOptions } from '../../../main/src/types';
import type {
  ProxyParticipantRole,
  ProxySessionInfo,
} from '../../../common/types/proxyApi';

const { Text } = Typography;

const ROLE_TAGS: Record<ProxyParticipantRole, React.ReactNode> = {
  driver: (
    <Tag color="success" icon={<PlayCircleOutlined />}>
      Playing
    </Tag>
  ),
  spectator: (
    <Tag color="processing" icon={<EyeOutlined />}>
      Spectating
    </Tag>
  ),
  syncing: <Tag icon={<LoadingOutlined />}>Joining</Tag>,
};

interface ProxySessionCardProps {
  session: ProxySessionInfo;
  port: number;
  send: (event: string, data: Record<string, unknown>) => void;
}

interface ParticipantActionsProps {
  participant: ProxySessionInfo['participants'][number];
  send: ProxySessionCardProps['send'];
}

const ParticipantActions: React.FC<ParticipantActionsProps> = ({
  participant,
  send,
}) => (
  <Flex align="center" gap={4}>
    {participant.role === 'spectator' && (
      <Button
        size="small"
        type="text"
        icon={<SwapOutlined />}
        onClick={() => send('PROXY:SWITCH', { participantId: participant.id })}
      >
        Give control
      </Button>
    )}
    <Popconfirm
      title={`Kick ${participant.username}?`}
      onConfirm={() => send('PROXY:KICK', { participantId: participant.id })}
      okText="Kick"
      okButtonProps={{ danger: true }}
    >
      <Button size="small" type="text" danger>
        Kick
      </Button>
    </Popconfirm>
  </Flex>
);

/** One proxy session (one server connection) and the clients/bots attached to it. */
const ProxySessionCard: React.FC<ProxySessionCardProps> = ({
  session,
  port,
  send,
}) => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const [launching, setLaunching] = useState(false);
  const blocked = session.switching.supported
    ? undefined
    : session.switching.reasons.join('. ');
  // A lone participant is the session's own account, so it shares the header row.
  const solo =
    session.participants.length === 1 ? session.participants[0] : undefined;

  // Joining as the session's own account makes the proxy hand it control.
  const play = async () => {
    setLaunching(true);
    try {
      await window.ipcRenderer.get('LAUNCH_MINECRAFT', {
        username: session.account,
        version: session.version,
        server: `127.0.0.1:${port}`,
        gamemode: null,
      } satisfies LaunchMinecraftOptions);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Failed to launch Minecraft',
      );
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Card
      size="small"
      styles={{ body: { padding: token.paddingSM } }}
      style={{ background: token.colorFillQuaternary }}
    >
      <Flex vertical gap={token.marginSM}>
        <Flex align="center" justify="space-between" gap={token.marginXS}>
          <Flex align="center" gap={token.marginSM} style={{ minWidth: 0 }}>
            <Avatar
              shape="square"
              size={32}
              src={`https://crafthead.net/avatar/${session.account}`}
              icon={<UserOutlined />}
            />
            <Flex vertical style={{ minWidth: 0 }}>
              <Text strong ellipsis>
                {session.account}
              </Text>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {session.version}
                {solo && ` · ${solo.kind}`}
              </Text>
            </Flex>
          </Flex>
          {session.reconnecting ? (
            <Tooltip title={session.reconnecting.reason}>
              <Tag
                color="warning"
                icon={<SyncOutlined spin />}
                style={{ margin: 0 }}
              >
                Reconnecting {session.reconnecting.attempt}/
                {session.reconnecting.attempts}
              </Tag>
            </Tooltip>
          ) : (
            solo && (
              <span style={{ flexShrink: 0 }}>{ROLE_TAGS[solo.role]}</span>
            )
          )}
        </Flex>

        <Flex align="center" justify="space-between" wrap="wrap" gap={4}>
          <Flex gap={token.marginXS}>
            <Tooltip title={blocked ?? 'Open Minecraft and play this session'}>
              <Button
                size="small"
                type="primary"
                icon={<RocketOutlined />}
                loading={launching}
                disabled={!!blocked}
                onClick={play}
              >
                Play
              </Button>
            </Tooltip>
            <Tooltip
              title={
                blocked ??
                'Let the next client that connects take over this session'
              }
            >
              <Button
                size="small"
                icon={<SwapOutlined />}
                disabled={!!blocked}
                onClick={() =>
                  send('PROXY:ARM_SWITCH', { sessionId: session.id })
                }
              >
                Take over
              </Button>
            </Tooltip>
            <Tooltip
              title={
                session.debugRecording
                  ? 'Stop debug recording'
                  : 'Debug-record all packets'
              }
            >
              <Button
                size="small"
                icon={<BugOutlined />}
                danger={!!session.debugRecording}
                type={session.debugRecording ? 'dashed' : 'default'}
                onClick={() =>
                  send(
                    session.debugRecording
                      ? 'PROXY:STOP_DEBUG_RECORDING'
                      : 'PROXY:START_DEBUG_RECORDING',
                    { sessionId: session.id },
                  )
                }
              />
            </Tooltip>
          </Flex>
          {solo && <ParticipantActions participant={solo} send={send} />}
        </Flex>

        {!solo && session.participants.length > 0 && (
          <>
            <Divider style={{ margin: 0 }} />
            <Flex vertical gap={token.marginXS}>
              {session.participants.map((participant) => (
                <Flex
                  key={participant.id}
                  align="center"
                  justify="space-between"
                  gap={token.marginSM}
                  wrap="wrap"
                >
                  <Flex
                    align="center"
                    gap={token.marginXS}
                    style={{ minWidth: 0 }}
                  >
                    <Avatar
                      size={20}
                      src={`https://crafthead.net/avatar/${participant.username}`}
                      icon={<UserOutlined />}
                    />
                    <Text ellipsis>{participant.username}</Text>
                    <Text type="secondary">{participant.kind}</Text>
                    {ROLE_TAGS[participant.role]}
                  </Flex>
                  <ParticipantActions participant={participant} send={send} />
                </Flex>
              ))}
            </Flex>
          </>
        )}
      </Flex>
    </Card>
  );
};

export default ProxySessionCard;
