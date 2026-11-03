import React from 'react';
import { Flex, theme } from 'antd';
import Devices from '../components/connections/Devices';
import Host from '../components/connections/Host';

const Connections: React.FC = () => {
  return <ConnectionsContent />;
};

const ConnectionsContent = () => {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap={token.marginLG} style={{ width: '100%' }}>
      <Host />
      <Devices />
    </Flex>
  );
};

export default Connections;
