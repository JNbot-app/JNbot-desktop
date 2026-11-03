import { Typography, theme } from 'antd';
import type { ReactNode } from 'react';

const { Title, Text } = Typography;

/** Title plus one line of context, shared by every profile editor section. */
const SectionHeader = ({ title, children }: { title: string; children?: ReactNode }) => {
  const { token } = theme.useToken();
  return (
    <div style={{ marginBottom: token.marginLG }}>
      <Title level={4} style={{ margin: 0 }}>
        {title}
      </Title>
      {children && <Text type="secondary">{children}</Text>}
    </div>
  );
};

export default SectionHeader;
