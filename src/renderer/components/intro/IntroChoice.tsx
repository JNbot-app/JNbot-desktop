import type { ReactNode } from 'react';
import { Card, Flex, Spin, Typography, theme } from 'antd';
import { RightOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface IntroChoiceProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  loading?: boolean;
  onClick: () => void;
}

/** Large clickable option row used by the intro's "pick a path" questions. */
const IntroChoice = ({ icon, title, subtitle, loading, onClick }: IntroChoiceProps) => {
  const { token } = theme.useToken();

  return (
    <Card
      hoverable
      size="small"
      onClick={loading ? undefined : onClick}
      styles={{ body: { padding: token.padding } }}
    >
      <Flex align="center" gap={token.margin}>
        <Flex
          align="center"
          justify="center"
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: token.borderRadius,
            background: token.colorPrimaryBg,
            color: token.colorPrimary,
            fontSize: token.fontSizeLG,
          }}
        >
          {icon}
        </Flex>
        <Flex vertical style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <Text strong>{title}</Text>
          <Text type="secondary">{subtitle}</Text>
        </Flex>
        {loading ? <Spin size="small" /> : <RightOutlined style={{ color: token.colorTextTertiary }} />}
      </Flex>
    </Card>
  );
};

export default IntroChoice;
