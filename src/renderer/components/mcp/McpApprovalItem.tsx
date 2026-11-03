import React, { useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Collapse,
  Flex,
  Statistic,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { McpApprovalRequest } from '../../../common/mcp';
import ProfileSelector from '../ProfileSelector';
import McpCodeViewer from './McpCodeViewer';

const { Text } = Typography;

export type ApprovalDecision = {
  approved: boolean;
  remember: boolean;
  profileKeys?: string[];
};

interface McpApprovalItemProps {
  approval: McpApprovalRequest;
  onDecide: (approval: McpApprovalRequest, decision: ApprovalDecision) => Promise<void>;
}

const riskStyle = {
  high: { tag: 'error', color: 'colorError', bg: 'colorErrorBg' },
  medium: { tag: 'warning', color: 'colorWarning', bg: 'colorWarningBg' },
  low: { tag: 'processing', color: 'colorInfo', bg: 'colorInfoBg' },
} as const;

const McpApprovalItem: React.FC<McpApprovalItemProps> = ({ approval, onDecide }) => {
  const { token } = theme.useToken();
  const [remember, setRemember] = useState(false);
  const [profileKeys, setProfileKeys] = useState<string[]>([]);
  const [deciding, setDeciding] = useState<'approve' | 'deny'>();

  const risk = riskStyle[approval.risk];
  const { code, source: _source, ...params } = approval.arguments;
  const hasCode = typeof code === 'string';
  const isPairing = approval.tool === 'pair_mcp_client';
  const language = approval.arguments.language === 'ts' ? 'typescript' : 'javascript';
  const target = [approval.target?.profileKey, approval.target?.account]
    .filter(Boolean)
    .join(' · ');

  const decide = async (approved: boolean) => {
    setDeciding(approved ? 'approve' : 'deny');
    try {
      await onDecide(approval, {
        approved,
        remember: approved && remember,
        profileKeys: isPairing ? profileKeys : undefined,
      });
    } finally {
      setDeciding(undefined);
    }
  };

  return (
    <Card
      size="small"
      style={{ borderInlineStart: `3px solid ${token[risk.color]}` }}
      styles={{ body: { padding: token.paddingMD } }}
    >
      <Flex vertical gap={token.marginMD}>
        <Flex justify="space-between" align="flex-start" gap={token.marginMD}>
          <Flex align="center" gap={token.marginSM} style={{ minWidth: 0 }}>
            <Avatar
              shape="square"
              size={40}
              icon={hasCode ? <CodeOutlined /> : <SafetyCertificateOutlined />}
              style={{ background: token[risk.bg], color: token[risk.color], flexShrink: 0 }}
            />
            <div style={{ minWidth: 0 }}>
              <Text strong style={{ display: 'block' }}>
                {approval.summary}
              </Text>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                <Text strong type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {approval.clientName}
                </Text>{' '}
                wants to use <Text code>{approval.tool}</Text>
                {target && ` on ${target}`}
              </Text>
            </div>
          </Flex>
          <Flex vertical align="flex-end" gap={4} style={{ flexShrink: 0 }}>
            <Tag color={risk.tag} variant="filled" style={{ margin: 0 }}>
              {approval.risk} risk
            </Tag>
            <Statistic.Timer
              type="countdown"
              value={approval.expiresAt}
              format="m:ss"
              prefix={<Text type="secondary" style={{ fontSize: token.fontSizeSM }}>Expires in</Text>}
              styles={{ content: { fontSize: token.fontSizeSM, color: token.colorTextSecondary } }}
            />
          </Flex>
        </Flex>

        {isPairing && (
          <Flex vertical gap={6}>
            <Text type="secondary">Give this client access to:</Text>
            <ProfileSelector
              value={profileKeys}
              includeAll
              style={{ width: '100%' }}
              onChange={setProfileKeys}
              placeholder="Select profiles"
            />
          </Flex>
        )}

        {hasCode && (
          <McpCodeViewer code={code} language={language} height={220} title="Script to run" />
        )}

        {approval.pluginDiff && (
          <McpCodeViewer
            diff={approval.pluginDiff}
            language={language}
            height={280}
            title="Plugin changes"
          />
        )}

        {Object.keys(params).length > 0 && (
          <Collapse
            size="small"
            items={[
              {
                key: 'params',
                label: 'Request details',
                children: (
                  <pre
                    style={{
                      margin: 0,
                      maxHeight: 180,
                      overflow: 'auto',
                      fontSize: token.fontSizeSM,
                      fontFamily: token.fontFamilyCode,
                    }}
                  >
                    {JSON.stringify(params, null, 2)}
                  </pre>
                ),
              },
            ]}
          />
        )}

        <Flex
          justify="space-between"
          align="center"
          gap={token.marginSM}
          wrap="wrap"
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            paddingTop: token.paddingSM,
          }}
        >
          {!approval.codeHash && !approval.pluginDiff ? (
            <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>
              Don&apos;t ask again for 15 minutes
            </Checkbox>
          ) : (
            <span />
          )}
          <Flex gap={token.marginXS}>
            <Button
              danger
              icon={<CloseOutlined />}
              loading={deciding === 'deny'}
              disabled={deciding === 'approve'}
              onClick={() => void decide(false)}
            >
              Deny
            </Button>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={deciding === 'approve'}
              disabled={deciding === 'deny' || (isPairing && profileKeys.length === 0)}
              onClick={() => void decide(true)}
            >
              Approve
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </Card>
  );
};

export default McpApprovalItem;
