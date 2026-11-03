import { useState } from 'react';
import { Button, Flex, Form, Input, Typography, theme } from 'antd';
import {
  CloudDownloadOutlined,
  CloudSyncOutlined,
  FileZipOutlined,
  ImportOutlined,
  LeftOutlined,
} from '@ant-design/icons';
import IntroChoice from './IntroChoice';
import IntroStepHeader from './IntroStepHeader';
import useAppApi from '../../hooks/useAppApi';
import useBackupImport, {
  restoreCloudBackup,
} from '../settings/backup/useBackupImport';

const { Text } = Typography;

type Source = 'choose' | 'cloud' | 'dropbox';

interface IntroImportStepProps {
  onBack: () => void;
  onImported: () => void;
}

const IntroImportStep = ({ onBack, onImported }: IntroImportStepProps) => {
  const { token } = theme.useToken();
  const [source, setSource] = useState<Source>('choose');
  const importBackup = useBackupImport();
  const [importing, setImporting] = useState(false);

  const importFile = async () => {
    setImporting(true);
    const imported = await importBackup();
    setImporting(false);
    if (imported) onImported();
  };

  return (
    <Flex vertical gap={token.marginLG}>
      <IntroStepHeader
        icon={<ImportOutlined />}
        title="Bring your JNbot data"
        subtitle="Your alts, profiles and plugins come along."
      />

      {source === 'choose' && (
        <Flex vertical gap={token.marginSM}>
          <IntroChoice
            icon={<CloudDownloadOutlined />}
            title="JNbot Cloud"
            subtitle="Restore with your User ID and share key."
            onClick={() => setSource('cloud')}
          />
          <IntroChoice
            icon={<CloudSyncOutlined />}
            title="Dropbox"
            subtitle="Use the JNbot data synced to your Dropbox."
            onClick={() => setSource('dropbox')}
          />
          <IntroChoice
            icon={<FileZipOutlined />}
            title="Backup file"
            subtitle="Import a file exported from JNbot."
            loading={importing}
            onClick={importFile}
          />
        </Flex>
      )}
      {source === 'cloud' && <CloudRestore onRestored={onImported} />}
      {source === 'dropbox' && <DropboxConnect />}

      <Button
        icon={<LeftOutlined />}
        onClick={source === 'choose' ? onBack : () => setSource('choose')}
        style={{ alignSelf: 'flex-start' }}
      >
        Back
      </Button>
    </Flex>
  );
};

const CloudRestore = ({ onRestored }: { onRestored: () => void }) => {
  const { message } = useAppApi();
  const [loading, setLoading] = useState(false);

  const restore = async ({ userId, shareKey }: { userId: string; shareKey: string }) => {
    setLoading(true);
    const error = await restoreCloudBackup(userId, shareKey);
    setLoading(false);
    if (error) {
      message.error(error);
      return;
    }
    message.success('Data restored from JNbot Cloud');
    onRestored();
  };

  return (
    <Form layout="vertical" requiredMark={false} onFinish={restore}>
      <Form.Item
        label="User ID"
        name="userId"
        rules={[{ required: true, whitespace: true, message: 'Enter your User ID' }]}
      >
        <Input autoFocus />
      </Form.Item>
      <Form.Item
        label="Share key"
        name="shareKey"
        rules={[{ required: true, whitespace: true, message: 'Enter your share key' }]}
      >
        <Input.Password />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={loading}>
        Restore
      </Button>
    </Form>
  );
};

type DropboxStatus = { accounts: { id: string }[] };

const DropboxConnect = () => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const [verifier, setVerifier] = useState('');
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    perform(async () => {
      const status = await window.ipcRenderer.invoke<DropboxStatus>('storage:status');
      setKnownIds((status?.accounts ?? []).map((account) => account.id));
      const login = await window.ipcRenderer.invoke<{ url: string; verifier: string }>(
        'storage:begin-login',
      );
      setVerifier(login.verifier);
      await window.ipcRenderer.invoke('storage:open-login', login.url);
    });

  const connect = () =>
    perform(async () => {
      const status = await window.ipcRenderer.invoke<DropboxStatus>(
        'storage:complete-login',
        code.trim(),
        verifier,
      );
      // Use the account that was just signed in to.
      const account =
        status.accounts.find((item) => !knownIds.includes(item.id)) ??
        status.accounts[status.accounts.length - 1];
      await window.ipcRenderer.invoke('storage:select', 'dropbox', account?.id);
      message.success('Connected. JNbot restarts to load your Dropbox data.');
    });

  if (!verifier) {
    return (
      <Button type="primary" block loading={busy} onClick={signIn}>
        Sign in to Dropbox
      </Button>
    );
  }

  return (
    <Flex vertical gap={token.marginSM}>
      <Text type="secondary">Paste the code Dropbox shows after you sign in.</Text>
      <Input
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Dropbox authorization code"
      />
      <Button type="primary" block loading={busy} disabled={!code.trim()} onClick={connect}>
        Connect and restart
      </Button>
    </Flex>
  );
};

export default IntroImportStep;
