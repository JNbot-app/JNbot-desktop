import React from 'react';
import { Badge, Flex, Typography, theme } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import type { McpApprovalRequest } from '../../../common/mcp';
import McpApprovalItem, { type ApprovalDecision } from './McpApprovalItem';

const { Text } = Typography;

interface McpApprovalQueueProps {
  approvals: McpApprovalRequest[];
  onDecide: (approval: McpApprovalRequest, decision: ApprovalDecision) => Promise<void>;
}

const McpApprovalQueue: React.FC<McpApprovalQueueProps> = ({ approvals, onDecide }) => {
  const { token } = theme.useToken();

  if (approvals.length === 0) return null;

  return (
    <Flex vertical gap={token.marginSM}>
      <Flex align="center" gap={token.marginXS}>
        <BellOutlined style={{ color: token.colorWarning }} />
        <Text strong>Waiting for your approval</Text>
        <Badge count={approvals.length} />
      </Flex>
      {approvals.map((approval) => (
        <McpApprovalItem key={approval.id} approval={approval} onDecide={onDecide} />
      ))}
    </Flex>
  );
};

export default McpApprovalQueue;
