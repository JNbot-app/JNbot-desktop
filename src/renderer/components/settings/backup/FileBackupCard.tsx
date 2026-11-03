import React, { useState } from 'react';
import { Button, Card, Flex, Space, Typography, theme } from 'antd';
import { ExportOutlined, ImportOutlined } from '@ant-design/icons';
import useAppApi from 'renderer/hooks/useAppApi';
import { withAlpha } from 'renderer/components/intro/introUtils';
import useBackupImport from './useBackupImport';

const { Text, Title } = Typography;

const FileBackupCard: React.FC = () => {
  const { token } = theme.useToken();
  const { message, modal } = useAppApi();
  const [exportLoading, setExportLoading] = useState(false);
  const importBackup = useBackupImport();

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const success =
        await window.ipcRenderer.get<boolean>('EXPORT_SETTINGS');
      if (success) {
        message.success('Settings exported successfully');
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Error exporting settings',
      );
    } finally {
      setExportLoading(false);
    }
  };

  const handleImport = () => {
    modal.confirm({
      title: 'Import backup from file',
      content:
        'This will replace your current settings, accounts, stats, and plugins with the contents of the backup file. Are you sure you want to continue?',
      okText: 'Select file & import',
      okType: 'primary',
      onOk: importBackup,
    });
  };

  return (
    <Card
      variant="borderless"
      style={{
        background: withAlpha(token.colorBgElevated, 0.4),
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
      styles={{
        body: {
          padding: token.paddingLG,
          display: 'flex',
          flexDirection: 'column',
          gap: token.marginMD,
        },
      }}
    >
      <Flex
        justify="space-between"
        align="center"
        wrap="wrap"
        gap={token.marginMD}
      >
        <div>
          <Title level={5} style={{ margin: 0 }}>
            Offline File Backup
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Export a local archive file to your machine or restore from an existing file.
          </Text>
        </div>

        <Space size={token.marginSM}>
          <Button
            icon={<ExportOutlined />}
            loading={exportLoading}
            onClick={handleExport}
          >
            Export to file
          </Button>
          <Button icon={<ImportOutlined />} onClick={handleImport}>
            Import from file
          </Button>
        </Space>
      </Flex>
    </Card>
  );
};

export default FileBackupCard;
