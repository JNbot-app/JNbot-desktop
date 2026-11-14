import React, { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  Switch,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  LinkOutlined,
  PlayCircleOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  useSettingsStore,
  selectScripts,
  selectSettings,
  updateScriptSettings,
} from '../../redux/settings';
import { SettingsObj } from '../../../main/src/types';
import type { ProxyInfo } from '../../../common/types/proxyApi';
import ProxySessionCard from './ProxySessionCard';

const { Text } = Typography;

interface ProxyCardProps {
  isProxyActive: boolean;
  sessions: ProxyInfo['sessions'];
  scriptInstanceId: number;
  onStartProxy: () => Promise<void>;
}

const ProxyCard: React.FC<ProxyCardProps> = ({
  isProxyActive,
  sessions,
  scriptInstanceId,
  onStartProxy,
}) => {
  const { token } = theme.useToken();
  const settings = useSettingsStore(selectSettings) as SettingsObj;
  const scripts = useSettingsStore(selectScripts);
  const proxyConfig = settings.scripts?.jnbotproxy ?? {};
  const port = Number(proxyConfig.port) || 25565;
  const [isLoading, setIsLoading] = useState(false);

  const startProxy = async () => {
    setIsLoading(true);
    try {
      await onStartProxy();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSettingChange = (key: string, value: any) => {
    updateScriptSettings({ optionId: key, value, scriptName: 'jnbotproxy' });
  };

  const send = (event: string, data: Record<string, unknown>) =>
    scripts.send(scriptInstanceId, event, data);

  return (
    <Flex vertical gap={token.marginMD}>
      {/* Proxy Settings / Connection Info Card */}
      <Card
        title={
          <Flex align="center" justify="space-between">
            <span>Connection Details</span>
            <Badge
              status={isProxyActive ? 'success' : 'default'}
              text={isProxyActive ? 'Running' : 'Stopped'}
            />
          </Flex>
        }
        style={{
          borderColor: token.colorBorderSecondary,
          background: token.colorBgContainer,
        }}
      >
        {!isProxyActive ? (
          <Form layout="vertical">
            <Form.Item label="Proxy Port">
              <Input
                prefix={
                  <LinkOutlined style={{ color: token.colorTextTertiary }} />
                }
                value={proxyConfig.port ?? 25565}
                onChange={(e) => handleSettingChange('port', e.target.value)}
                placeholder="25565"
              />
            </Form.Item>
            <Form.Item
              label="Record sessions from join"
              tooltip="Saves every packet of each new session from login on, for movement replay tests (npm run test:movement)."
            >
              <Switch
                checked={!!proxyConfig.recordFromJoin}
                onChange={(checked) => handleSettingChange('recordFromJoin', checked)}
              />
            </Form.Item>

            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={startProxy}
              loading={isLoading}
              block
            >
              Start Proxy
            </Button>
          </Form>
        ) : (
          <Flex justify="space-between" align="center">
            <Text type="secondary">Host address</Text>
            <Text code copyable={{ text: `127.0.0.1:${port}` }}>
              127.0.0.1:{port}
            </Text>
          </Flex>
        )}
      </Card>

      {/* Connected Players Card */}
      {isProxyActive && (
        <Card
          title={
            <Flex align="center" gap={8}>
              <UserOutlined />
              <span>Sessions</span>
              {sessions.length > 0 && <Tag>{sessions.length}</Tag>}
            </Flex>
          }
          style={{
            borderColor: token.colorBorderSecondary,
            background: token.colorBgContainer,
          }}
        >
          {sessions.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`Join 127.0.0.1:${port} in Minecraft to start a session`}
            />
          ) : (
            <Flex vertical gap={token.marginSM}>
              {sessions.map((session) => (
                <ProxySessionCard
                  key={session.id}
                  session={session}
                  port={port}
                  send={send}
                />
              ))}
            </Flex>
          )}
        </Card>
      )}
    </Flex>
  );
};

export default ProxyCard;
