/* eslint-disable react/jsx-filename-extension, import/extensions */
import { Button, Card, Space, Typography, theme } from 'antd';
import { CloudServerOutlined, PlusOutlined } from '@ant-design/icons';
import { Navigate, useNavigate } from 'react-router-dom';

import { useSettingsStore, selectInstalledServerIds } from '../redux/settings';
import ServerPickList from '../components/marketplace/ServerPickList';

const { Title, Text } = Typography;

/**
 * Shown when servers are installed but none could be opened. Users without
 * any server go through the intro instead.
 */
const SelectServerPage = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const hasServers = useSettingsStore(
    (s) => selectInstalledServerIds(s).length > 0,
  );
  const selectedProfileKey = useSettingsStore((s) => s.selectedProfileKey);

  if (!hasServers) return <Navigate to="/intro" replace />;
  if (selectedProfileKey) return <Navigate to="/" replace />;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: token.paddingLG,
      }}
    >
      <Card
        style={{
          width: 'min(680px, 100%)',
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowSecondary,
        }}
        styles={{ body: { padding: token.paddingXL } }}
      >
        <Space
          orientation="vertical"
          size={token.marginLG}
          style={{ width: '100%', textAlign: 'center' }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto',
              borderRadius: token.borderRadiusLG,
              background: token.colorPrimaryBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CloudServerOutlined
              style={{ color: token.colorPrimary, fontSize: 24 }}
            />
          </div>

          <div>
            <Title level={3} style={{ margin: 0 }}>
              Choose a server
            </Title>
            <Text type="secondary">
              Start with a ready-made profile for your Minecraft server.
            </Text>
          </div>

          <ServerPickList />

          <Card
            size="small"
            variant="borderless"
            style={{
              width: '100%',
              border: `1px dashed ${token.colorBorder}`,
              background: token.colorFillAlter,
            }}
          >
            <Space
              style={{
                width: '100%',
                justifyContent: 'space-between',
                textAlign: 'left',
              }}
            >
              <Space orientation="vertical" size={0}>
                <Text strong>Your server isn’t listed?</Text>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  Create a custom profile for another Minecraft server.
                </Text>
              </Space>
              <Button
                icon={<PlusOutlined />}
                onClick={() => navigate('/profiles/new')}
              >
                Create profile
              </Button>
            </Space>
          </Card>
        </Space>
      </Card>
    </div>
  );
};

export default SelectServerPage;
