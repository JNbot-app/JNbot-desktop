import { Button, Flex, theme } from 'antd';
import { CloudServerOutlined, LeftOutlined, PlusOutlined } from '@ant-design/icons';
import IntroStepHeader from './IntroStepHeader';
import ServerPickList from '../marketplace/ServerPickList';

interface IntroServerSelectStepProps {
  onBack: () => void;
  onCreate: () => void;
  onPicked: () => void;
}

const IntroServerSelectStep = ({ onBack, onCreate, onPicked }: IntroServerSelectStepProps) => {
  const { token } = theme.useToken();

  return (
    <Flex vertical gap={token.marginLG}>
      <IntroStepHeader
        icon={<CloudServerOutlined />}
        title="Pick a server"
        subtitle="Where should your bots play? You can add more servers later."
      />

      <ServerPickList onPicked={onPicked} />

      <Flex justify="space-between" gap={token.marginSM}>
        <Button icon={<LeftOutlined />} onClick={onBack}>
          Back
        </Button>
        <Button type="link" icon={<PlusOutlined />} onClick={onCreate}>
          Server not listed? Add it yourself
        </Button>
      </Flex>
    </Flex>
  );
};

export default IntroServerSelectStep;
