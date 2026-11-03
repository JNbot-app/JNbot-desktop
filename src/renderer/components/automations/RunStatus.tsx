import { Badge, Button, Flex, Progress, Space, Typography, theme } from 'antd';
import {
  PauseOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { AutomationSessionStatus } from '../../../common/automation';

const { Text } = Typography;

/** options shown with their chance */
const SHOWN_CHANCES = 3;

type Doing = NonNullable<
  NonNullable<AutomationSessionStatus['practice']>['doing']
>;

/** what the AI picked to do, and how likely each option seemed */
function PracticeDoing({ doing }: { doing: Doing }) {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap={token.marginXXS}>
      {doing.chances.slice(0, SHOWN_CHANCES).map(([name, chance]) => (
        <Flex key={name} align="center" gap={token.marginSM}>
          <Text
            ellipsis
            strong={name === doing.name}
            type={name === doing.name ? undefined : 'secondary'}
            style={{ width: '45%', flexShrink: 0 }}
          >
            {name}
          </Text>
          <Progress
            percent={Math.round(chance * 100)}
            size="small"
            status={name === doing.name ? 'active' : 'normal'}
            style={{ margin: 0, flex: 1 }}
          />
        </Flex>
      ))}
    </Flex>
  );
}

interface RunStatusProps {
  session: AutomationSessionStatus;
  onControl: (action: 'pause' | 'resume' | 'stop') => void;
}

/** A running replay, AI run or practice, with its controls. */
export default function RunStatus({ session, onControl }: RunStatusProps) {
  const { token } = theme.useToken();
  const { practice } = session;
  const paused = session.state === 'paused';
  const corrections = practice?.corrections ?? 0;
  const who = session.target.username ?? 'a bot';

  return (
    <Flex
      vertical
      gap={token.marginSM}
      style={{
        padding: `${token.paddingSM}px ${token.padding}px`,
        background: token.colorFillQuaternary,
        borderRadius: token.borderRadiusLG,
      }}
    >
      <Flex gap={token.marginSM} align="center" justify="space-between">
        <Badge
          status={
            paused || practice?.control === 'you' ? 'warning' : 'processing'
          }
          text={
            <Text strong>
              {practice
                ? session.message
                : `${paused ? 'Paused' : 'Running'} on ${who}`}
            </Text>
          }
        />
        <Space size={token.marginXS}>
          {/* practice pauses by taking over in game */}
          {!practice && (
            <Button
              size="small"
              icon={paused ? <PlayCircleOutlined /> : <PauseOutlined />}
              aria-label={paused ? 'Resume' : 'Pause'}
              onClick={() => onControl(paused ? 'resume' : 'pause')}
            />
          )}
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            onClick={() => onControl('stop')}
          >
            Stop
          </Button>
        </Space>
      </Flex>
      {!practice && session.totalSteps > 0 && (
        <Progress
          size="small"
          percent={Math.round((100 * session.currentStep) / session.totalSteps)}
          format={() => `${session.currentStep}/${session.totalSteps}`}
          style={{ margin: 0 }}
        />
      )}
      {corrections > 0 && (
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {corrections} correction{corrections === 1 ? '' : 's'} saved
        </Text>
      )}
      {practice?.doing && <PracticeDoing doing={practice.doing} />}
    </Flex>
  );
}
