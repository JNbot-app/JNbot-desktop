import React, { useEffect, useState } from 'react';
import { Modal, Space, Typography, Button, Flex, theme } from 'antd';
import { CopyOutlined, ExportOutlined } from '@ant-design/icons';
import useAppApi from '../../hooks/useAppApi';

interface MicrosoftLoginModalProps {
  open: boolean;
  userCode: string;
  verificationUri: string;
  expiresAt: number | undefined;
  onClose: () => void;
}

function MicrosoftLoginModal({
  open,
  userCode,
  verificationUri,
  expiresAt,
  onClose,
}: MicrosoftLoginModalProps) {
  const { message } = useAppApi();
  const { token } = theme.useToken();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!open || expiresAt === undefined) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [open, userCode, expiresAt]);

  const seconds =
    expiresAt === undefined
      ? undefined
      : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = seconds === 0;
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(`${label} copied`);
    } catch {
      message.error('Could not copy. Select and copy the text manually.');
    }
  };
  const openUrl = () => {
    try {
      window.open(verificationUri, '_blank', 'noopener,noreferrer');
    } catch {
      message.error(
        'Could not open Microsoft. Copy the URL and open it in your browser.',
      );
    }
  };

  return (
    <Modal
      open={open}
      title="Sign in to Microsoft"
      onCancel={onClose}
      footer={null}
      width={480}
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Open the verification URL and enter this code. To sign in on another
          device, send the URL and code together.
        </Typography.Paragraph>
        <Flex
          vertical
          align="center"
          gap="small"
          style={{
            padding: token.paddingLG,
            background: token.colorFillAlter,
            borderRadius: token.borderRadiusLG,
          }}
        >
          <Typography.Text type="secondary">Device code</Typography.Text>
          <Typography.Text
            strong
            style={{
              fontFamily: token.fontFamilyCode,
              fontSize: token.fontSizeHeading2,
              letterSpacing: 3,
              overflowWrap: 'anywhere',
              textAlign: 'center',
            }}
          >
            {userCode}
          </Typography.Text>
          <Button
            icon={<CopyOutlined aria-hidden />}
            disabled={expired || !userCode}
            onClick={() => copy(userCode, 'Code')}
          >
            Copy code
          </Button>
          {seconds !== undefined && (
            <Typography.Text type={expired ? 'danger' : 'secondary'}>
              {expired
                ? 'Code expired. Start sign-in again to get a new code.'
                : `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
            </Typography.Text>
          )}
        </Flex>
        <Flex vertical gap="small">
          <Typography.Text strong>Verification URL</Typography.Text>
          <Flex align="center" gap="small">
            <Typography.Text
              style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
            >
              {verificationUri}
            </Typography.Text>
            <Button
              aria-label="Copy verification URL"
              icon={<CopyOutlined aria-hidden />}
              disabled={expired || !verificationUri}
              onClick={() => copy(verificationUri, 'URL')}
            />
          </Flex>
        </Flex>
        <Flex vertical gap="small">
          <Button
            type="primary"
            block
            icon={<ExportOutlined aria-hidden />}
            disabled={expired || !verificationUri || !userCode}
            onClick={openUrl}
          >
            Open Microsoft
          </Button>
          <Button
            block
            icon={<CopyOutlined aria-hidden />}
            disabled={expired || !verificationUri || !userCode}
            onClick={() =>
              copy(`${verificationUri}\nCode: ${userCode}`, 'URL and code')
            }
          >
            Copy URL and code
          </Button>
        </Flex>
      </Space>
    </Modal>
  );
}

export default MicrosoftLoginModal;
