import { Flex, Typography, theme } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

const FileDropOverlay = () => {
  const { token } = theme.useToken();

  return (
    <Flex
      align="center"
      justify="center"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10000,
        padding: token.paddingLG,
        background: token.colorBgMask,
        backdropFilter: 'blur(4px)',
        pointerEvents: 'none',
      }}
    >
      <Flex
        vertical
        align="center"
        justify="center"
        gap={token.marginXS}
        style={{
          width: '100%',
          height: '100%',
          border: `${token.lineWidthBold}px dashed ${token.colorPrimary}`,
          borderRadius: token.borderRadiusLG,
          background: token.colorBgElevated,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        <InboxOutlined style={{ fontSize: 56, color: token.colorPrimary }} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Drop to import
        </Typography.Title>
        <Typography.Text type="secondary">Only .jnp plugin files are imported</Typography.Text>
      </Flex>
    </Flex>
  );
};

export default FileDropOverlay;
