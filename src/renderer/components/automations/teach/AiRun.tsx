import { useState } from 'react';
import {
  Button,
  Flex,
  Modal,
  Progress,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  AimOutlined,
  BulbOutlined,
  ControlOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import {
  ENOUGH_EXAMPLES_MS,
  RECORDING_BRAIN_STEP_MS,
  rareMoments,
  type BrainInfo,
  type BrainLearnSettings,
  type BrainTrainStatus,
} from '../../../../common/brainSpec';
import TeachActions from './TeachActions';
import TeachConnect from './TeachConnect';
import TeachSkill from './TeachSkill';
import TeachModel from './model/TeachModel';

const { Text } = Typography;

const ENOUGH_MINUTES = ENOUGH_EXAMPLES_MS / 60_000;

interface AiRunProps {
  pluginId: string;
  info: BrainInfo;
  training: BrainTrainStatus | null;
  learn?: BrainLearnSettings;
  onLearnChange: (learn: BrainLearnSettings) => void;
  clientConnected: boolean;
  hasBot: boolean;
  /** something already runs */
  busy: boolean;
  onPractice: () => void;
  onPlayBot: () => void;
  onOpenLauncher: () => void;
}

/** "Play with AI": how far it learned from the takes, and the ways to run it. */
export default function AiRun({
  pluginId,
  info,
  training,
  learn,
  onLearnChange,
  clientConnected,
  hasBot,
  busy,
  onPractice,
  onPlayBot,
  onOpenLauncher,
}: AiRunProps) {
  const { token } = theme.useToken();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasTakes = info.examples.length > 0;
  const minutes =
    (info.examples.reduce((n, e) => n + e.steps, 0) * RECORDING_BRAIN_STEP_MS) /
    60_000;
  // one hint at most: the rarest thing they did
  const rare = rareMoments(info.noticed).sort((a, b) => a.times - b.times)[0];
  const blocked = !hasTakes
    ? 'Record a take first'
    : busy
      ? 'Stop what is running first'
      : undefined;

  return (
    <Flex vertical gap={token.marginSM}>
      <Flex vertical gap={token.marginXXS}>
        <Flex align="center" gap={token.marginXS}>
          <RobotOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Play with AI</Text>
        </Flex>
        <Text type="secondary">
          Learns from all your takes and reacts to what's around it, even in a
          different spot.
        </Text>
      </Flex>

      {hasTakes && (
        <Flex vertical gap={token.marginXXS}>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {minutes.toFixed(1)} of ~{ENOUGH_MINUTES} min recorded
          </Text>
          {/* one segment per minute */}
          <Progress
            steps={ENOUGH_MINUTES}
            percent={Math.min(100, (100 * minutes) / ENOUGH_MINUTES)}
            showInfo={false}
            size={[40, 6]}
            style={{ margin: 0 }}
          />
        </Flex>
      )}

      {hasTakes && <TeachSkill model={info.model} training={training} />}

      {rare && (
        <Flex gap={token.marginXS} align="baseline">
          <BulbOutlined style={{ color: token.colorWarning }} />
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {rare.name}: {rare.times} time{rare.times === 1 ? '' : 's'} so far.
            Doing it a few more times helps the AI pick it up.
          </Text>
        </Flex>
      )}

      {clientConnected || hasBot ? (
        <Flex gap={token.marginXS} wrap>
          {clientConnected && (
            <Tooltip
              title={
                blocked ??
                'It plays your game; take over with your keys to correct it'
              }
            >
              <Button
                type="primary"
                icon={<AimOutlined />}
                disabled={!!blocked}
                onClick={onPractice}
              >
                Practice in my game
              </Button>
            </Tooltip>
          )}
          {hasBot && (
            <Tooltip title={blocked}>
              <Button
                type={clientConnected ? 'default' : 'primary'}
                icon={<RobotOutlined />}
                disabled={!!blocked}
                onClick={onPlayBot}
              >
                Run on a bot
              </Button>
            </Tooltip>
          )}
        </Flex>
      ) : (
        <TeachConnect
          message="Connect your Minecraft client or a bot to run the AI."
          onOpenLauncher={onOpenLauncher}
        />
      )}

      <Flex gap={token.marginMD} wrap>
        <Button
          size="small"
          type="link"
          icon={<ControlOutlined />}
          style={{ padding: 0 }}
          disabled={!hasTakes}
          onClick={() => setSettingsOpen(true)}
        >
          What it learns
        </Button>
        {info.model && <TeachModel pluginId={pluginId} />}
      </Flex>

      <Modal
        title="What the AI learns"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
        width={620}
        destroyOnHidden
      >
        <TeachActions info={info} learn={learn} onChange={onLearnChange} />
      </Modal>
    </Flex>
  );
}
