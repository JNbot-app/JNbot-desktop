import { Button, Flex, Typography, theme } from 'antd';
import { CheckOutlined, UserAddOutlined } from '@ant-design/icons';
import IntroStepHeader from './IntroStepHeader';
import { GETTING_STARTED_STEPS } from './useGettingStarted';
import { useSettingsStore, selectActiveServerId, selectJNdata } from '../../redux/settings';

const { Text } = Typography;

interface IntroReadyStepProps {
  onAddAlt: () => void;
  onExplore: () => void;
}

const IntroReadyStep = ({ onAddAlt, onExplore }: IntroReadyStepProps) => {
  const { token } = theme.useToken();
  const serverName = useSettingsStore(
    (s) => selectJNdata(s)?.data?.[selectActiveServerId(s) ?? '']?.name,
  );

  return (
    <Flex vertical gap={token.marginLG}>
      <IntroStepHeader
        icon={<CheckOutlined />}
        title={`${serverName ?? 'Your server'} is ready`}
        subtitle="Three quick steps left. A checklist keeps track of them for you."
      />

      <Flex vertical gap={token.marginSM}>
        {GETTING_STARTED_STEPS.map((step, index) => (
          <Flex
            key={step.id}
            align="center"
            gap={token.marginSM}
            style={{
              padding: `${token.paddingSM}px ${token.padding}px`,
              borderRadius: token.borderRadiusLG,
              background: token.colorFillQuaternary,
            }}
          >
            <Flex
              align="center"
              justify="center"
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: token.colorPrimaryBg,
                color: token.colorPrimary,
                fontSize: token.fontSizeSM,
                fontWeight: 600,
              }}
            >
              {index + 1}
            </Flex>
            <Text>{step.title}</Text>
          </Flex>
        ))}
      </Flex>

      <Flex justify="flex-end" gap={token.marginSM}>
        <Button onClick={onExplore}>Explore on my own</Button>
        <Button type="primary" icon={<UserAddOutlined />} onClick={onAddAlt}>
          Add my first alt
        </Button>
      </Flex>
    </Flex>
  );
};

export default IntroReadyStep;
