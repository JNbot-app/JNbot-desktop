import {
  Avatar,
  Badge,
  Button,
  Flex,
  Space,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  ArrowLeftOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  SlidersOutlined,
  StopOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { AutomationSessionStatus } from '../../../common/automation';

const { Title, Text } = Typography;

interface RecordingHeaderProps {
  title: string;
  summary: string;
  /** username of the connected Minecraft client */
  clientName?: string;
  /** the take being recorded */
  recording?: AutomationSessionStatus;
  /** something else (a replay, practice) runs */
  busy: boolean;
  onBack: () => void;
  onOptions: () => void;
  onEditPlugin: () => void;
  onRecord: () => void;
  onOpenLauncher: () => void;
  onControl: (action: 'pause' | 'resume' | 'stop') => void;
}

export default function RecordingHeader({
  title,
  summary,
  clientName,
  recording,
  busy,
  onBack,
  onOptions,
  onEditPlugin,
  onRecord,
  onOpenLauncher,
  onControl,
}: RecordingHeaderProps) {
  const { token } = theme.useToken();
  const paused = recording?.state === 'paused';

  return (
    <Flex vertical gap={token.marginMD}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={onBack}
        style={{ width: 'fit-content', padding: 0 }}
      >
        Back to plugins
      </Button>

      <Flex justify="space-between" align="center" wrap gap={token.marginMD}>
        <Flex align="center" gap={token.marginMD} style={{ minWidth: 0 }}>
          <Avatar
            shape="square"
            size={52}
            icon={<VideoCameraOutlined />}
            style={{
              flex: 'none',
              borderRadius: token.borderRadiusLG,
              background: recording ? token.colorErrorBg : token.colorPrimaryBg,
              color: recording ? token.colorError : token.colorPrimary,
              border: `1px solid ${recording ? token.colorErrorBorder : token.colorPrimaryBorder}`,
            }}
          />
          <Flex vertical gap={2} style={{ minWidth: 0 }}>
            <Title level={3} ellipsis style={{ margin: 0, fontWeight: 600 }}>
              {title}
            </Title>
            {recording ? (
              <Badge
                status={paused ? 'warning' : 'processing'}
                color={paused ? undefined : token.colorError}
                text={
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {paused ? 'Paused' : 'Recording'} · {recording.currentStep}{' '}
                    actions · {paused ? 'F9 resumes' : 'F9 pauses'}, F8 stops
                  </Text>
                }
              />
            ) : (
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {summary}
              </Text>
            )}
          </Flex>
        </Flex>

        <Space wrap>
          {clientName ? (
            <Badge
              status="success"
              text={<Text type="secondary">{clientName} in Minecraft</Text>}
            />
          ) : (
            <Button onClick={onOpenLauncher}>Launch Minecraft</Button>
          )}
          <Tooltip title="Plugin settings">
            <Button
              icon={<SettingOutlined />}
              onClick={onEditPlugin}
              aria-label="Plugin settings"
            />
          </Tooltip>
          <Tooltip title="Plugin options">
            <Button
              icon={<SlidersOutlined />}
              onClick={onOptions}
              aria-label="Plugin options"
            />
          </Tooltip>
          {recording ? (
            <>
              <Button
                icon={paused ? <PlayCircleOutlined /> : <PauseOutlined />}
                onClick={() => onControl(paused ? 'resume' : 'pause')}
              >
                {paused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                type="primary"
                danger
                icon={<StopOutlined />}
                onClick={() => onControl('stop')}
              >
                Stop
              </Button>
            </>
          ) : (
            <Tooltip
              title={
                !clientName
                  ? 'Launch Minecraft with the JNbot mod first'
                  : busy
                    ? 'Stop what is running first'
                    : 'Or press F8 in game'
              }
            >
              <Button
                type="primary"
                icon={<VideoCameraOutlined />}
                disabled={!clientName || busy}
                onClick={onRecord}
              >
                Record take
              </Button>
            </Tooltip>
          )}
        </Space>
      </Flex>
    </Flex>
  );
}
