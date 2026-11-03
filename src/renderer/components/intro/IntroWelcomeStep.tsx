import { Flex, Typography, theme } from 'antd';
import { ImportOutlined, RocketOutlined } from '@ant-design/icons';
import jnbotIcon from '../../assets/jnbot.png';
import IntroChoice from './IntroChoice';

const { Title, Text } = Typography;

interface IntroWelcomeStepProps {
  onNew: () => void;
  onExisting: () => void;
}

const IntroWelcomeStep = ({ onNew, onExisting }: IntroWelcomeStepProps) => {
  const { token } = theme.useToken();

  return (
    <Flex vertical gap={token.marginLG}>
      <Flex vertical align="center" gap={token.marginXS} style={{ textAlign: 'center' }}>
        <img src={jnbotIcon} alt="JNbot logo" style={{ width: 72, height: 72 }} />
        <Title level={2} style={{ margin: 0 }}>
          Welcome to JNbot
        </Title>
        <Text type="secondary" style={{ fontSize: token.fontSizeLG }}>
          Bots that join Minecraft servers with your accounts and automate tasks.
        </Text>
      </Flex>

      <Flex vertical gap={token.marginSM}>
        <IntroChoice
          icon={<RocketOutlined />}
          title="I'm new to JNbot"
          subtitle="Set up your first bot in a few steps."
          onClick={onNew}
        />
        <IntroChoice
          icon={<ImportOutlined />}
          title="I've used JNbot before"
          subtitle="Import from JNbot Cloud, Dropbox or a backup file."
          onClick={onExisting}
        />
      </Flex>
    </Flex>
  );
};

export default IntroWelcomeStep;
