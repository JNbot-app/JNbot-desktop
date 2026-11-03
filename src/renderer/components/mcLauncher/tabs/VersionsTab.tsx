import React from 'react';
import { Card, Space, Typography, theme as antTheme } from 'antd';
import VersionBrowser from '../VersionBrowser';
import type { VersionItem } from '../VersionBrowser';

interface VersionsTabProps {
  versions: VersionItem[];
  versionsLoading: boolean;
  selectedVersion: { id: string; launcherFlags: number } | null;
  onSelect: (selection: { versionId: string; launcherFlags: number }) => void;
}

const VersionsTab: React.FC<VersionsTabProps> = ({
  versions,
  versionsLoading,
  selectedVersion,
  onSelect,
}) => {
  const {
    token: { colorBgContainer, colorBorderSecondary, borderRadius },
  } = antTheme.useToken();

  return (
    <Card
      style={{
        backgroundColor: colorBgContainer,
        border: `1px solid ${colorBorderSecondary}`,
        borderRadius,
        animation: 'fadeIn 0.4s ease-out',
      }}
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        <div>
          <Typography.Title
            level={4}
            style={{
              marginTop: 0,
              marginBottom: 8,
              fontFamily: 'monospace',
              letterSpacing: '0.5px',
            }}
          >
            Select Minecraft Version
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            Choose a version to play. Your selection will be used when you launch.
          </Typography.Paragraph>
        </div>
        {versionsLoading ? (
          <Typography.Text type="secondary">Loading versions…</Typography.Text>
        ) : (
          <VersionBrowser
            versions={versions}
            selectedVersion={selectedVersion}
            onSelect={onSelect}
          />
        )}
      </Space>
    </Card>
  );
};

export default VersionsTab;
