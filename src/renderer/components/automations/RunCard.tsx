import type { ReactNode } from 'react';
import { Button, Card, Divider, Flex, Tooltip, Typography, theme } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import type { AutomationSessionStatus } from '../../../common/automation';
import RunStatus from './RunStatus';

const { Text } = Typography;

interface RunCardProps {
  /** a running replay, AI run or practice */
  session?: AutomationSessionStatus;
  hasSteps: boolean;
  /** e.g. "Take 2" */
  takeLabel?: string;
  /** "Play with AI" */
  ai: ReactNode;
  onReplay: () => void;
  onControl: (action: 'pause' | 'resume' | 'stop') => void;
}

/** The two ways to run what was recorded, side by side so either is one click away. */
export default function RunCard({
  session,
  hasSteps,
  takeLabel,
  ai,
  onReplay,
  onControl,
}: RunCardProps) {
  const { token } = theme.useToken();

  return (
    <Card
      title="Run"
      style={{
        position: 'sticky',
        top: token.marginMD,
        borderColor: token.colorBorderSecondary,
      }}
    >
      <Flex vertical gap={token.marginMD}>
        {session && <RunStatus session={session} onControl={onControl} />}

        <Flex vertical gap={token.marginSM}>
          <Flex vertical gap={token.marginXXS}>
            <Flex align="center" gap={token.marginXS}>
              <PlayCircleOutlined style={{ color: token.colorPrimary }} />
              <Text strong>Replay exactly</Text>
            </Flex>
            <Text type="secondary">
              {hasSteps
                ? `Repeats ${takeLabel ?? 'the recorded steps'} step for step. Best for fixed routines started from the same spot.`
                : 'Record a take to replay it step for step.'}
            </Text>
          </Flex>
          <Tooltip title={session ? 'Stop what is running first' : undefined}>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={!hasSteps || !!session}
              onClick={onReplay}
              style={{ alignSelf: 'flex-start' }}
            >
              Replay
            </Button>
          </Tooltip>
        </Flex>

        <Divider style={{ margin: 0 }} />

        {ai}
      </Flex>
    </Card>
  );
}
