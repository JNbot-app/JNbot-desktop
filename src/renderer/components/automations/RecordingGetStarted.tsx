import { Button, Card, Flex, Steps, Typography, theme } from 'antd';
import { VideoCameraOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface RecordingGetStartedProps {
  clientName?: string;
  onRecord: () => void;
  onOpenLauncher: () => void;
}

/** Shown until the first take: what recording is and the one thing to do next. */
export default function RecordingGetStarted({
  clientName,
  onRecord,
  onOpenLauncher,
}: RecordingGetStartedProps) {
  const { token } = theme.useToken();

  return (
    <Card style={{ borderColor: token.colorBorderSecondary }}>
      <Flex
        vertical
        align="center"
        gap={token.marginLG}
        style={{
          maxWidth: 640,
          margin: '0 auto',
          padding: `${token.paddingLG}px 0`,
          textAlign: 'center',
        }}
      >
        <Flex vertical gap={token.marginXS}>
          <Title level={4} style={{ margin: 0 }}>
            Record your first take
          </Title>
          <Text type="secondary">
            Play the task in Minecraft while JNbot watches. Afterwards, replay
            it exactly or let an AI learn from it and adapt to what's around it.
            You don't have to choose now.
          </Text>
        </Flex>

        <Steps
          size="small"
          current={clientName ? 1 : 0}
          style={{ textAlign: 'left' }}
          items={[
            {
              title: 'Connect',
              content: clientName
                ? `${clientName} is connected`
                : 'Launch Minecraft with the JNbot mod',
            },
            {
              title: 'Record',
              content: 'Play the task. F8 stops, F9 pauses',
            },
            {
              title: 'Run',
              content: 'Replay exactly or with AI',
            },
          ]}
        />

        {clientName ? (
          <Button
            type="primary"
            size="large"
            icon={<VideoCameraOutlined />}
            onClick={onRecord}
          >
            Record take
          </Button>
        ) : (
          <Button type="primary" size="large" onClick={onOpenLauncher}>
            Launch Minecraft
          </Button>
        )}
      </Flex>
    </Card>
  );
}
