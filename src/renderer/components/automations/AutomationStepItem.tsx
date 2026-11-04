import React from 'react';
import { Button, Flex, Space, Tag, Typography, theme } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { AutomationStep } from '../../../common/automation';
import { actionLabel, describeStep } from './automationUtils';
import AutomationStepFields from './AutomationStepFields';

const { Text } = Typography;

interface AutomationStepItemProps {
  step: AutomationStep;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<AutomationStep>) => void;
}

const AutomationStepItem: React.FC<AutomationStepItemProps> = ({
  step,
  isSelected,
  onSelect,
  onDelete,
  onUpdate,
}) => {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        borderRadius: token.borderRadius,
        opacity: step.enabled || isSelected ? 1 : 0.5,
        border: `1px solid ${
          isSelected ? token.colorPrimaryBorder : token.colorBorderSecondary
        }`,
        background: isSelected ? token.colorFillQuaternary : undefined,
        transition: `all ${token.motionDurationFast}`,
      }}
    >
      <Flex
        align="center"
        justify="space-between"
        gap="small"
        role="button"
        tabIndex={0}
        aria-expanded={isSelected}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect();
        }}
        style={{
          padding: `${token.paddingXS}px ${token.paddingSM}px`,
          cursor: 'pointer',
        }}
      >
        <Flex align="center" gap="small" style={{ minWidth: 0, flex: 1 }}>
          <Tag variant="filled" style={{ margin: 0, flexShrink: 0 }}>
            {actionLabel(step.kind)}
          </Tag>
          <Text ellipsis style={{ flex: 1 }}>
            {step.label || describeStep(step)}
          </Text>
        </Flex>
        <Space size={token.marginXS} style={{ flexShrink: 0 }}>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {(step.atMs / 1000).toFixed(2)}s
          </Text>
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            aria-label="Delete step"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          />
        </Space>
      </Flex>
      {isSelected && (
        <div
          style={{
            padding: `${token.paddingXS}px ${token.paddingSM}px ${token.paddingSM}px`,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <AutomationStepFields step={step} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
};

export default React.memo(AutomationStepItem);
