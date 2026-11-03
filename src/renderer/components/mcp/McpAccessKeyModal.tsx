import React, { useState } from 'react';
import {
  Button,
  Collapse,
  Flex,
  Input,
  Modal,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import type { PairingResult } from './types';

const { Text } = Typography;

interface McpAccessKeyModalProps {
  pairingResult?: PairingResult;
  connectionEndpoint?: string;
  onClose: () => void;
  onCopy: (value: string, label?: string) => void;
}

const McpAccessKeyModal: React.FC<McpAccessKeyModalProps> = ({
  pairingResult,
  connectionEndpoint,
  onClose,
  onCopy,
}) => {
  const { token } = theme.useToken();
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  if (!pairingResult) return null;

  const endpoint = pairingResult.endpoint ?? connectionEndpoint;
  const stdioJson = JSON.stringify(pairingResult.stdio, null, 2);

  const handleCopyKey = () => {
    onCopy(pairingResult.token, 'Access key copied');
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleCopyEndpoint = () => {
    if (!endpoint) return;
    onCopy(endpoint, 'Endpoint copied');
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  const handleCopyConfig = () => {
    onCopy(stdioJson, 'Configuration copied');
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  return (
    <Modal
      open={Boolean(pairingResult)}
      title="Client Access Key"
      footer={
        <Button block type="primary" onClick={onClose}>
          Done
        </Button>
      }
      onCancel={onClose}
      destroyOnHidden
    >
      <Flex vertical gap={16} style={{ paddingTop: 8 }}>
        <Flex align="center" gap={8}>
          <Tag
            color="warning"
            variant="filled"
            style={{ margin: 0, padding: '2px 8px' }}
          >
            Important
          </Tag>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Copy this access key now. It cannot be viewed again.
          </Text>
        </Flex>

        <Input.TextArea
          readOnly
          autoSize={{ minRows: 2, maxRows: 4 }}
          value={pairingResult.token}
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            background: token.colorFillQuaternary,
          }}
        />

        <Button
          block
          size="middle"
          type="primary"
          icon={copiedKey ? <CheckOutlined /> : <CopyOutlined />}
          onClick={handleCopyKey}
        >
          {copiedKey ? 'Copied' : 'Copy access key'}
        </Button>

        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'details',
              label: (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Manual connection config
                </Text>
              ),
              children: (
                <Flex vertical gap={12}>
                  {endpoint && (
                    <Flex vertical gap={4}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        HTTP Endpoint
                      </Text>
                      <Input
                        readOnly
                        size="small"
                        value={endpoint}
                        suffix={
                          <Tooltip title={copiedEndpoint ? 'Copied' : 'Copy'}>
                            <Button
                              type="text"
                              size="small"
                              icon={
                                copiedEndpoint ? (
                                  <CheckOutlined />
                                ) : (
                                  <CopyOutlined />
                                )
                              }
                              onClick={handleCopyEndpoint}
                              style={{ padding: 0, height: 'auto' }}
                            />
                          </Tooltip>
                        }
                      />
                    </Flex>
                  )}

                  <Flex vertical gap={4}>
                    <Flex justify="space-between" align="center">
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        stdio configuration
                      </Text>
                      <Button
                        type="link"
                        size="small"
                        icon={
                          copiedConfig ? <CheckOutlined /> : <CopyOutlined />
                        }
                        onClick={handleCopyConfig}
                        style={{ padding: 0, fontSize: 12 }}
                      >
                        {copiedConfig ? 'Copied' : 'Copy config'}
                      </Button>
                    </Flex>
                    <pre
                      style={{
                        margin: 0,
                        maxHeight: 160,
                        overflow: 'auto',
                        padding: token.paddingSM,
                        borderRadius: token.borderRadiusSM,
                        background: token.colorFillQuaternary,
                        fontSize: 11,
                        fontFamily: 'monospace',
                      }}
                    >
                      {stdioJson}
                    </pre>
                  </Flex>
                </Flex>
              ),
            },
          ]}
        />
      </Flex>
    </Modal>
  );
};

export default McpAccessKeyModal;
