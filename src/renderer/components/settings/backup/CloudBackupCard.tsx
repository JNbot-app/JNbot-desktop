import React, { FC, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Flex,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  CheckCircleFilled,
  CheckOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import useAppApi from 'renderer/hooks/useAppApi';
import { withAlpha } from 'renderer/components/intro/introUtils';
import { restoreCloudBackup } from './useBackupImport';

const { Text, Title } = Typography;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const generateShareKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(25));
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    if (i > 0 && i % 5 === 0) out += '-';
    out += BASE32_ALPHABET[bytes[i] & 0x1f];
  }
  return out;
};

type JNbotCloudInfo = {
  used: boolean;
  userId: string;
  error?: string | null;
};

const CloudBackupCard: FC = () => {
  const { token } = theme.useToken();
  const { message, modal } = useAppApi();

  const [info, setInfo] = useState<JNbotCloudInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);

  // Upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [shareKey, setShareKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Restore modal state
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreForm] = Form.useForm<{ userId: string; shareKey: string }>();

  // Delete state
  const [removeLoading, setRemoveLoading] = useState(false);

  const fetchInfo = async () => {
    try {
      const data =
        await window.ipcRenderer.get<JNbotCloudInfo>('CLOUD_STORAGE_INFO');
      setInfo(data);
    } catch {
      // Ignored
    } finally {
      setLoadingInfo(false);
    }
  };

  useEffect(() => {
    void fetchInfo();
  }, []);

  const openUpload = () => {
    setShareKey(generateShareKey());
    setKeySaved(false);
    setKeyCopied(false);
    setUploadError(null);
    setUploadModalOpen(true);
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(shareKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 1500);
    } catch {
      // clipboard access error fallback
    }
  };

  const handleUpload = async () => {
    if (!keySaved || !shareKey) return;
    setUploadLoading(true);
    setUploadError(null);
    try {
      const result = await window.ipcRenderer.get<{
        status: 'success' | 'publisher-name-required' | 'error';
        message?: string;
        identity?: { fingerprint?: string };
      }>('CLOUD_STORAGE_UPLOAD', { shareKey });

      if (result.status === 'publisher-name-required') {
        let publisherName = '';
        const configured = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: 'Set your publisher name',
            content: (
              <Space orientation="vertical" style={{ width: '100%', marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  Device fingerprint:{' '}
                  {result.identity?.fingerprint?.match(/.{1,4}/g)?.join(' ') ??
                    'Unavailable'}
                </Text>
                <Input
                  autoFocus
                  maxLength={100}
                  placeholder="Publisher name"
                  onChange={(e) => {
                    publisherName = e.target.value;
                  }}
                />
              </Space>
            ),
            okText: 'Save and continue',
            onOk: async () => {
              const savedIdentity = await window.ipcRenderer.get<{
                status: string;
                message?: string;
              }>('SET_PUBLISHER_NAME', publisherName);
              if (savedIdentity.status !== 'success') {
                throw new Error(savedIdentity.message);
              }
              resolve(true);
            },
            onCancel: () => resolve(false),
          });
        });

        if (configured) {
          await handleUpload();
          return;
        }
        setUploadLoading(false);
        return;
      }

      if (result.status === 'error') {
        throw new Error(result.message || 'Failed to upload backup.');
      }

      message.success('Encrypted backup saved to cloud');
      setUploadModalOpen(false);
      await fetchInfo();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to save data to cloud.',
      );
    } finally {
      setUploadLoading(false);
    }
  };

  const openRestore = () => {
    restoreForm.resetFields();
    if (info?.userId) {
      restoreForm.setFieldsValue({ userId: info.userId });
    }
    setRestoreConfirmed(false);
    setRestoreError(null);
    setRestoreModalOpen(true);
  };

  const handleRestore = async () => {
    const values = await restoreForm.validateFields().catch(() => null);
    if (!values) return;
    setRestoreLoading(true);
    setRestoreError(null);
    const error = await restoreCloudBackup(values.userId, values.shareKey);
    setRestoreLoading(false);
    if (error) {
      setRestoreError(error);
      return;
    }
    message.success('Data successfully restored from cloud');
    setRestoreModalOpen(false);
    await fetchInfo();
  };

  const confirmDelete = () => {
    modal.confirm({
      title: 'Delete Cloud Snapshot?',
      content:
        'This will permanently delete your encrypted backup stored in the JNbot cloud.',
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        setRemoveLoading(true);
        try {
          await window.ipcRenderer.get('CLOUD_STORAGE_REMOVE');
          await fetchInfo();
        } finally {
          setRemoveLoading(false);
        }
      },
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
      <div>
        <Title level={5} style={{ margin: 0 }}>
          JNbot Cloud
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Store encrypted snapshot stored remotely for backup.
        </Text>
      </div>

      {loadingInfo ? (
        <Flex justify="center" style={{ padding: token.paddingMD }}>
          <Spin size="small" />
        </Flex>
      ) : (
        <Flex
          justify="space-between"
          align="center"
          wrap="wrap"
          gap={token.marginMD}
        >
          {/* Status & User ID */}
          <Space size={token.marginSM} wrap align="center">
            {info?.used ? (
              <Tag
                color="success"
                icon={<CheckCircleFilled />}
                style={{ margin: 0 }}
              >
                Snapshot available
              </Tag>
            ) : (
              <Tag style={{ margin: 0 }}>No snapshot</Tag>
            )}
            {info?.userId && (
              <Space size={4}>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  User ID:
                </Text>
                <Text
                  code
                  copyable={{ tooltips: ['Copy User ID', 'Copied!'] }}
                  style={{ fontSize: 13 }}
                >
                  {info.userId}
                </Text>
              </Space>
            )}
          </Space>

          {/* Action buttons */}
          <Space size={token.marginSM} wrap>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              onClick={openUpload}
            >
              {info?.used ? 'Update Backup' : 'Back up to Cloud'}
            </Button>
            <Button icon={<CloudDownloadOutlined />} onClick={openRestore}>
              Restore from Cloud
            </Button>
            {info?.used && (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                loading={removeLoading}
                onClick={confirmDelete}
              >
                Delete
              </Button>
            )}
          </Space>
        </Flex>
      )}

      {info?.error && (
        <Text type="danger" style={{ fontSize: 13 }}>
          <WarningOutlined style={{ marginRight: 6 }} />
          {info.error}
        </Text>
      )}

      {/* Upload Modal */}
      <Modal
        open={uploadModalOpen}
        title="Back up to JNbot Cloud"
        onCancel={() => !uploadLoading && setUploadModalOpen(false)}
        footer={
          <Flex justify="end" gap={8}>
            <Button
              disabled={uploadLoading}
              onClick={() => setUploadModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="primary"
              loading={uploadLoading}
              disabled={!keySaved}
              onClick={() => void handleUpload()}
            >
              Save to Cloud
            </Button>
          </Flex>
        }
      >
        <Space orientation="vertical" size={token.marginMD} style={{ width: '100%', marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Data is encrypted client-side using this Share Key before uploading.
          </Text>

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              User ID
            </Text>
            <Input value={info?.userId} disabled />
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              Generated Share Key
            </Text>
            <Flex gap={8}>
              <Input
                value={shareKey}
                readOnly
                style={{
                  fontFamily: 'monospace',
                  letterSpacing: 1,
                  fontSize: 13,
                }}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Tooltip title={keyCopied ? 'Copied!' : 'Copy to clipboard'}>
                <Button
                  icon={keyCopied ? <CheckOutlined /> : <CopyOutlined />}
                  onClick={copyKey}
                />
              </Tooltip>
              <Tooltip title="Generate new key">
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    setShareKey(generateShareKey());
                    setKeySaved(false);
                  }}
                />
              </Tooltip>
            </Flex>
          </div>

          <div
            style={{
              padding: token.paddingSM,
              borderRadius: token.borderRadius,
              background: withAlpha(token.colorWarning, 0.1),
              border: `1px solid ${withAlpha(token.colorWarning, 0.3)}`,
            }}
          >
            <Text style={{ fontSize: 12, color: token.colorWarningText }}>
              Save this key safely. If lost, your encrypted cloud backup cannot be recovered.
            </Text>
          </div>

          <Checkbox
            checked={keySaved}
            onChange={(e) => setKeySaved(e.target.checked)}
          >
            <Text style={{ fontSize: 13 }}>
              I have saved my Share Key in a safe place
            </Text>
          </Checkbox>

          {uploadError && (
            <Text type="danger" style={{ fontSize: 13 }}>
              <WarningOutlined style={{ marginRight: 6 }} />
              {uploadError}
            </Text>
          )}
        </Space>
      </Modal>

      {/* Restore Modal */}
      <Modal
        open={restoreModalOpen}
        title="Restore from JNbot Cloud"
        onCancel={() => !restoreLoading && setRestoreModalOpen(false)}
        footer={
          <Flex justify="end" gap={8}>
            <Button
              disabled={restoreLoading}
              onClick={() => setRestoreModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="primary"
              loading={restoreLoading}
              disabled={!restoreConfirmed}
              onClick={() => void handleRestore()}
            >
              Restore Data
            </Button>
          </Flex>
        }
      >
        <Form form={restoreForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            label="User ID"
            name="userId"
            rules={[{ required: true, message: 'Please enter the user ID' }]}
          >
            <Input placeholder="Enter User ID" />
          </Form.Item>

          <Form.Item
            label="Share Key"
            name="shareKey"
            rules={[{ required: true, message: 'Please enter the share key' }]}
            extra="Paste your 25-character share key."
          >
            <Input.Password placeholder="Enter Share Key" />
          </Form.Item>

          <div
            style={{
              padding: token.paddingSM,
              borderRadius: token.borderRadius,
              background: withAlpha(token.colorWarning, 0.1),
              border: `1px solid ${withAlpha(token.colorWarning, 0.3)}`,
              marginBottom: token.marginMD,
            }}
          >
            <Text style={{ fontSize: 12, color: token.colorWarningText }}>
              Restoring will replace your current settings, accounts, stats, and plugins.
            </Text>
          </div>

          <Checkbox
            checked={restoreConfirmed}
            onChange={(e) => setRestoreConfirmed(e.target.checked)}
          >
            <Text style={{ fontSize: 13 }}>
              I understand this will overwrite current local data
            </Text>
          </Checkbox>

          {restoreError && (
            <div style={{ marginTop: token.marginSM }}>
              <Text type="danger" style={{ fontSize: 13 }}>
                <WarningOutlined style={{ marginRight: 6 }} />
                {restoreError}
              </Text>
            </div>
          )}
        </Form>
      </Modal>
    </Card>
  );
};

export default CloudBackupCard;
