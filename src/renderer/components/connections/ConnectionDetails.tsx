import { useMemo, useState } from 'react';
import {
  Button,
  Col,
  Flex,
  Input,
  QRCode,
  Row,
  Segmented,
  Space,
  Typography,
  theme,
} from 'antd';
import {
  CheckOutlined,
  CopyOutlined,
  GlobalOutlined,
  MobileOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { Device, DeviceObj, JNbotServerStatus } from '../../../main/src/types';
import useAppApi from '../../hooks/useAppApi';
import { buildAccessUrl, buildMobileAccessUrl } from './connectionUtils';

const { Title, Text } = Typography;

interface ConnectionDetailsProps {
  server?: JNbotServerStatus['peer2peer'] | { url?: string; room?: string };
  device?: Device | DeviceObj;
  qrSize?: number;
  showSecurityNotice?: boolean;
}

const ConnectionDetails = ({
  server,
  device,
  qrSize = 180,
  showSecurityNotice = true,
}: ConnectionDetailsProps) => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const [connectionType, setConnectionType] = useState<'web' | 'mobile'>('web');
  const [copied, setCopied] = useState(false);

  const accessUrl = useMemo(
    () => buildAccessUrl(server, device),
    [server, device],
  );
  const mobileAccessUrl = useMemo(
    () => buildMobileAccessUrl(server, device),
    [server, device],
  );

  const currentUrl = connectionType === 'web' ? accessUrl : mobileAccessUrl;

  const copyLink = async () => {
    if (!currentUrl) return;
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      message.success(
        connectionType === 'web'
          ? 'Web access link copied'
          : 'Mobile app link copied',
      );
    } catch {
      message.error('Could not copy the link');
    }
  };

  return (
    <Row gutter={[token.marginLG, token.marginLG]} align="middle">
      <Col xs={24} sm={10} md={10}>
        <Flex vertical align="center" gap={token.marginSM}>
          <div
            style={{
              padding: token.paddingSM,
              background: token.colorBgElevated,
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <QRCode
              value={currentUrl}
              size={qrSize}
              variant="filled"
              status={currentUrl ? 'active' : 'loading'}
            />
          </div>
          <Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM, textAlign: 'center' }}
          >
            {connectionType === 'web'
              ? 'Scan with your camera to open in web browser'
              : 'Scan with your phone to open in JNbot Mobile'}
          </Text>
        </Flex>
      </Col>

      <Col xs={24} sm={14} md={14}>
        <Flex vertical gap={token.marginMD}>
          <Segmented<'web' | 'mobile'>
            value={connectionType}
            onChange={(val) => {
              setConnectionType(val);
              setCopied(false);
            }}
            block
            options={[
              {
                label: (
                  <Space>
                    <GlobalOutlined />
                    <span>Web Browser</span>
                  </Space>
                ),
                value: 'web',
              },
              {
                label: (
                  <Space>
                    <MobileOutlined />
                    <span>JNbot Mobile App</span>
                  </Space>
                ),
                value: 'mobile',
              },
            ]}
          />

          <div>
            <Title level={5} style={{ margin: '0 0 4px 0' }}>
              {connectionType === 'web'
                ? 'Web Browser Link'
                : 'JNbot Mobile Deep Link'}
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {connectionType === 'web'
                ? 'Open this URL in Google Chrome, Safari, or any modern web browser.'
                : 'Use this link to connect directly in the JNbot native mobile app.'}
            </Text>
          </div>

          <Input
            value={currentUrl}
            readOnly
            aria-label={
              connectionType === 'web'
                ? 'Remote web access link'
                : 'JNbot Mobile deep link'
            }
            addonAfter={
              <Button
                type="text"
                size="small"
                icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                onClick={copyLink}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            }
          />

          {showSecurityNotice && (
            <Flex
              align="center"
              gap={token.marginXS}
              style={{
                background: token.colorWarningBg,
                border: `1px solid ${token.colorWarningBorder}`,
                padding: `${token.paddingXS}px ${token.paddingSM}px`,
                borderRadius: token.borderRadiusSM,
              }}
            >
              <WarningOutlined style={{ color: token.colorWarning }} />
              <Text style={{ fontSize: 13 }}>
                Anyone with this link can control JNbot. Only share it with devices you trust.
              </Text>
            </Flex>
          )}
        </Flex>
      </Col>
    </Row>
  );
};

export default ConnectionDetails;
