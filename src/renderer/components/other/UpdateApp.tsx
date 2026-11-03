import React from 'react';
import { useSettingsStore } from '../../redux/settings';
import { Button, Progress, Tooltip, Badge, Space, Typography } from 'antd';
import {
  ExclamationCircleOutlined,
  CloudDownloadOutlined,
} from '@ant-design/icons';
import type { UpdateData } from '../../../main/src/types';
import { UpdateState } from '../../../common/CommonEnums';

// status:
// 0: No update
// 1: Download progress: {percent}
// 2: Ready to install: {version}
// 3: Error: {error}
// 4: Installing

const UpdateApp: React.FC = () => {
  const updateData: UpdateData = useSettingsStore((state) => state.update) ?? {
    state: UpdateState.NO_UPDATE,
  };
  const installUpdate = () => {
    window.ipcRenderer.send('install-update');
  };

  // Downloading update...
  if (updateData.state === UpdateState.DOWNLOADING) {
    return (
      <Space align="center" size={8}>
        <Progress
          type="circle"
          percent={Math.floor(updateData.data)}
          size={24}
          strokeWidth={6}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Downloading...
        </Typography.Text>
      </Space>
    );
  } else if (
    updateData.state === UpdateState.READY_TO_INSTALL ||
    updateData.state === UpdateState.INSTALLING
  ) {
    // Ready to install
    return (
      <Button
        loading={updateData.state === UpdateState.INSTALLING}
        onClick={installUpdate}
        type="primary"
        size="small"
        icon={
          updateData.state === UpdateState.INSTALLING ? undefined : (
            <CloudDownloadOutlined />
          )
        }
        style={{
          fontWeight: 500,
          height: '32px',
          borderRadius: '16px',
        }}
      >
        {updateData.state === UpdateState.INSTALLING
          ? 'Installing...'
          : `Update v${updateData.data ?? ''}`}
      </Button>
    );
  } else if (updateData.state === UpdateState.ERROR) {
    // Error
    return (
      <Tooltip
        title={`Update failed: ${updateData.data ?? 'An error occurred, update via jnbot website.'}`}
      >
        <Button
          type="text"
          danger
          icon={<ExclamationCircleOutlined />}
          size="small"
          style={{
            height: '32px',
            borderRadius: '16px',
          }}
        >
          Update Error
        </Button>
      </Tooltip>
    );
  }

  return null;
};

export default UpdateApp;
