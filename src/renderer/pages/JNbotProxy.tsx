import React, { useEffect } from 'react';
import { Col, Flex, Row, theme } from 'antd';
import ProxyHeader from '../components/proxy/ProxyHeader';
import ProxyCard from '../components/proxy/ProxyCard';
import RecordingList from '../components/proxy/RecordingList';
import {
  useSettingsStore,
  selectScripts,
  selectJNbotProxyInfo,
} from '../redux/settings';
import { ProxyInfo } from '../../common/types/proxyApi';

const JNbotProxy: React.FC = () => {
  const { token } = theme.useToken();
  const scripts = useSettingsStore(selectScripts);
  const proxyInfo: ProxyInfo | null = useSettingsStore(selectJNbotProxyInfo);
  const sessions = proxyInfo?.sessions ?? [];
  const proxyInstanceId = scripts.getInstanceIdsByName('jnbotproxy')[0];
  const isActive = !!proxyInstanceId;

  useEffect(() => {
    const scriptInstanceId = scripts.getInstanceIdsByName('jnbotproxy')[0];
    if (proxyInfo === null && isActive && scriptInstanceId) {
      scripts.send(scriptInstanceId, 'PROXY:GET_INFO', {});
    }
  }, [proxyInfo, scripts, isActive]);

  const startProxy = async () => {
    await scripts.startScript({ script: 'jnbotproxy', arguments: {} });
  };

  const stopProxy = () => {
    scripts.stop(proxyInstanceId);
  };

  return (
    <Flex vertical gap={token.marginLG} style={{ width: '100%' }}>
      <ProxyHeader
        isActive={isActive}
        connectedCount={sessions.reduce(
          (count, session) => count + session.participants.length,
          0,
        )}
        onStartProxy={startProxy}
        onStopProxy={stopProxy}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10} xl={9}>
          <ProxyCard
            isProxyActive={isActive}
            sessions={sessions}
            scriptInstanceId={proxyInstanceId}
            onStartProxy={startProxy}
          />
        </Col>

        <Col xs={24} lg={14} xl={15}>
          <RecordingList />
        </Col>
      </Row>
    </Flex>
  );
};

export default JNbotProxy;
