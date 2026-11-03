import type { ReactNode } from 'react';
import { Flex, Typography, theme } from 'antd';
import { withAlpha } from './introUtils';

const { Title, Text } = Typography;

interface IntroStepHeaderProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
}

const IntroStepHeader = ({ icon, title, subtitle }: IntroStepHeaderProps) => {
  const { token } = theme.useToken();

  return (
    <Flex vertical align="center" gap={token.marginXS} style={{ textAlign: 'center' }}>
      <Flex
        align="center"
        justify="center"
        style={{
          width: 52,
          height: 52,
          borderRadius: token.borderRadiusLG,
          background: token.colorPrimaryBg,
          border: `1px solid ${withAlpha(token.colorPrimary, 0.35)}`,
          color: token.colorPrimary,
          fontSize: token.fontSizeHeading4,
        }}
      >
        {icon}
      </Flex>
      <Title level={3} style={{ margin: 0 }}>
        {title}
      </Title>
      <Text type="secondary">{subtitle}</Text>
    </Flex>
  );
};

export default IntroStepHeader;
