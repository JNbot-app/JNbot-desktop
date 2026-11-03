import React from 'react';
import { Card, Space, Typography, Input, Button, theme as antTheme } from 'antd';
import { LaunchMinecraftOptions } from '../../../../main/src/types';

interface SettingsTabProps {
  launcherOptions: LaunchMinecraftOptions;
  onLauncherOptionsChange?: (options: Partial<LaunchMinecraftOptions>) => void;
}



const SettingsTab: React.FC<SettingsTabProps> = ({
  launcherOptions,

  onLauncherOptionsChange,
}) => {
  const {
    token: { colorBgContainer, colorBorderSecondary, borderRadius },
  } = antTheme.useToken();


    const handleSelectDirectory = async () => {
      const result = await window.ipcRenderer.get('SELECT_DIRECTORY');
      const picked = result?.filePaths?.[0];
      if (!picked) return;
      onLauncherOptionsChange?.({ minecraftDirectory: picked });
    };

  return (
    <Card
      style={{
        backgroundColor: colorBgContainer,
        border: `1px solid ${colorBorderSecondary}`,
        borderRadius,
      }}
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        <div>
          <Typography.Title
            level={4}
            style={{
              marginTop: 0,
              fontFamily: 'monospace',
              letterSpacing: '0.5px',
            }}
          >
            Launcher Settings
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Configure launcher settings. 
          </Typography.Paragraph>
        </div>

        <Card
          size="small"
          style={{
            backgroundColor: `${colorBgContainer}dd`,
            border: `1px solid ${colorBorderSecondary}`,
            borderRadius,
          }}
        >
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Space orientation="vertical" size={0}>
              <Typography.Text strong style={{ fontFamily: 'monospace' }}>
                Minecraft Directory
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Optional. If set, versions/assets/mods use this folder.
              </Typography.Text>
            </Space>

            <Input
              value={launcherOptions.minecraftDirectory}
              readOnly
              placeholder="Using default app minecraft folder"
            />

            <Space wrap>
              <Button onClick={handleSelectDirectory}>Choose Directory</Button>

              <Button disabled={!launcherOptions.minecraftDirectory} onClick={() => onLauncherOptionsChange?.({ minecraftDirectory: undefined })} >
                Reset
              </Button>
            </Space>
          </Space>
        </Card>

        <Card
          size="small"
          style={{
            backgroundColor: `${colorBgContainer}dd`,
            border: `1px solid ${colorBorderSecondary}`,
            borderRadius,
          }}
        >
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Space orientation="vertical" size={0}>
              <Typography.Text strong style={{ fontFamily: 'monospace' }}>
                Extra JVM arguments
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Optional. Additional arguments to pass to the Java Virtual Machine.
              </Typography.Text>
            </Space>

            <Input
              placeholder="e.g. -Xmx2G -Xms1G -XX:+UseG1GC"
              style={{ width: '100%' }}
              value={launcherOptions.extraJvmArgs ?? ''}
              onChange={(e) => onLauncherOptionsChange?.({ extraJvmArgs: e.target.value })}
            />
          </Space>
        </Card>
      </Space>
    </Card>
  );
};

export default SettingsTab;
