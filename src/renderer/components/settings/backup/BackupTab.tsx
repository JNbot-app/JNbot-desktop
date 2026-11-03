import React from 'react';
import { Flex, theme } from 'antd';
import StorageModeCard from './StorageModeCard';
import CloudBackupCard from './CloudBackupCard';
import FileBackupCard from './FileBackupCard';

const BackupTab: React.FC = () => {
  const { token } = theme.useToken();

  return (
    <Flex
      vertical
      gap={token.marginMD}
      style={{
        width: '100%',
        maxWidth: 780,
        paddingBottom: token.paddingLG,
      }}
    >
      <StorageModeCard />
      <CloudBackupCard />
      <FileBackupCard />
    </Flex>
  );
};

export default BackupTab;
