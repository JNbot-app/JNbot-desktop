import { useState } from 'react';
import { Button, Collapse, Dropdown, Flex, Typography, theme } from 'antd';
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import type { AutomationStep } from '../../../common/automation';
import AutomationStepList from './AutomationStepList';
import {
  actionKinds,
  actionLabel,
  clock,
  type EditableKind,
} from './automationUtils';

const { Text } = Typography;

interface ReplayStepsCardProps {
  steps: AutomationStep[];
  durationMs: number;
  /** e.g. "Take 2", when the steps come from a take on this device */
  takeLabel?: string;
  onUpdate: (id: string, patch: Partial<AutomationStep>) => void;
  onDelete: (id: string) => void;
  /** adds a step; returns its id */
  onAdd: (kind: EditableKind) => string;
}

/** What exact replay repeats, folded away until someone wants to fine-tune it. */
export default function ReplayStepsCard({
  steps,
  durationMs,
  takeLabel,
  onUpdate,
  onDelete,
  onAdd,
}: ReplayStepsCardProps) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();

  return (
    <Collapse
      activeKey={open ? 'steps' : []}
      onChange={(keys) => setOpen(keys.includes('steps'))}
      style={{ background: token.colorBgContainer }}
      items={[
        {
          key: 'steps',
          label: (
            <Flex align="baseline" gap={token.marginSM} wrap>
              <Text strong>Replay steps</Text>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {[
                  takeLabel,
                  `${steps.length} ${steps.length === 1 ? 'action' : 'actions'}`,
                  clock(durationMs),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Flex>
          ),
          extra: (
            <Dropdown
              trigger={['click']}
              menu={{
                items: actionKinds.map((kind) => ({
                  key: kind,
                  label: actionLabel(kind),
                  onClick: ({ domEvent }) => {
                    domEvent.stopPropagation();
                    setSelectedId(onAdd(kind));
                    setOpen(true);
                  },
                })),
                style: { maxHeight: 320, overflowY: 'auto' },
              }}
            >
              <Button
                size="small"
                type="text"
                icon={<PlusOutlined />}
                onClick={(event) => event.stopPropagation()}
              >
                Add action <DownOutlined style={{ fontSize: 10 }} />
              </Button>
            </Dropdown>
          ),
          children: (
            <AutomationStepList
              steps={steps}
              selectedId={selectedId}
              onSelect={(id) =>
                setSelectedId((current) => (current === id ? undefined : id))
              }
              onDelete={(id) => {
                onDelete(id);
                if (id === selectedId) setSelectedId(undefined);
              }}
              onUpdate={onUpdate}
            />
          ),
        },
      ]}
    />
  );
}
