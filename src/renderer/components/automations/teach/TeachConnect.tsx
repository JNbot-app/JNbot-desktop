import { Button, Flex, Typography, theme } from 'antd';
import { DisconnectOutlined } from '@ant-design/icons';

const { Text } = Typography;

/** Says what to connect, with the way to do it, instead of greyed-out actions. */
export default function TeachConnect({
  message,
  onOpenLauncher,
}: {
  message: string;
  onOpenLauncher: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <Flex
      align="center"
      gap={token.marginSM}
      wrap="wrap"
      style={{
        padding: `${token.paddingSM}px ${token.padding}px`,
        background: token.colorFillQuaternary,
        border: `1px dashed ${token.colorBorder}`,
        borderRadius: token.borderRadiusLG,
      }}
    >
      <DisconnectOutlined style={{ color: token.colorTextTertiary }} />
      <Text type="secondary" style={{ flex: 1, minWidth: 180 }}>
        {message}
      </Text>
      <Button onClick={onOpenLauncher}>Open launcher</Button>
    </Flex>
  );
}
