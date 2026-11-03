import { FC } from 'react';
import { Button, Dropdown, Flex, Select, Tag, theme } from 'antd';
import {
  DeleteOutlined,
  DownOutlined,
  HolderOutlined,
  MoreOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ScriptActionInfo } from '../../../../main/src/types';
import { chainNextLabel, type ChainStep } from '../../../../common/chains';
import type { ActionOptionGroup } from '../../../utils/actionOptions';
import ChainStepDetails from './ChainStepDetails';

type Props = {
  step: ChainStep;
  steps: ChainStep[];
  index: number;
  action?: ScriptActionInfo;
  actionOptions: ActionOptionGroup[];
  expanded: boolean;
  onToggle: () => void;
  onChange: (step: ChainStep) => void;
  onSelectAction: (pluginId: string) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

/** Short labels for anything changed from the defaults, shown while collapsed. */
function changes(step: ChainStep, steps: ChainStep[]) {
  const count = Object.keys(step.options ?? {}).length;
  return [
    count > 0 && `${count} option${count === 1 ? '' : 's'} changed`,
    step.onSuccess && `Works → ${chainNextLabel(step.onSuccess, steps).toLowerCase()}`,
    step.onFail && `Fails → ${chainNextLabel(step.onFail, steps).toLowerCase()}`,
  ].filter(Boolean) as string[];
}

/** One step: drag handle, number, action, changes, and details that expand in place. */
const ChainStepRow: FC<Props> = ({
  step,
  steps,
  index,
  action,
  actionOptions,
  expanded,
  onToggle,
  onChange,
  onSelectAction,
  onMove,
  onRemove,
}) => {
  const { token } = theme.useToken();
  const sortable = useSortable({ id: step.id });
  const dragging = sortable.isDragging;
  const tags = expanded ? [] : changes(step, steps);

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
        position: 'relative',
        zIndex: dragging ? 1 : undefined,
        background: dragging || expanded ? token.colorBgElevated : undefined,
        boxShadow: dragging ? token.boxShadowSecondary : undefined,
        borderTop: index ? `1px solid ${token.colorBorderSecondary}` : undefined,
      }}
    >
      <Flex align="center" gap={8} style={{ padding: '8px 8px 8px 4px' }}>
        <Button
          type="text"
          size="small"
          icon={<HolderOutlined />}
          aria-label="Drag to reorder"
          style={{ cursor: dragging ? 'grabbing' : 'grab', color: token.colorTextTertiary }}
          {...sortable.attributes}
          {...sortable.listeners}
        />
        <span
          style={{
            flex: 'none',
            width: 24,
            height: 24,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: step.scriptId ? token.colorText : token.colorTextTertiary,
            background: token.colorFillSecondary,
          }}
        >
          {index + 1}
        </span>
        <Select
          value={step.scriptId || undefined}
          onChange={onSelectAction}
          placeholder="Choose an action"
          options={actionOptions}
          notFoundContent="No actions found"
          showSearch={{ optionFilterProp: 'label' }}
          variant="borderless"
          popupMatchSelectWidth={false}
          style={{ flex: 1, minWidth: 160, fontWeight: 500 }}
        />
        {tags.map((tag) => (
          <Tag key={tag} bordered={false} onClick={onToggle} style={{ cursor: 'pointer', marginInlineEnd: 0 }}>
            {tag}
          </Tag>
        ))}
        <Button
          type="text"
          onClick={onToggle}
          aria-expanded={expanded}
          icon={
            <DownOutlined
              style={{ fontSize: 11, transition: 'transform 200ms', transform: expanded ? 'rotate(180deg)' : undefined }}
            />
          }
          iconPlacement="end"
        >
          Details
        </Button>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'up', label: 'Move up', icon: <VerticalAlignTopOutlined />, disabled: index === 0, onClick: () => onMove(-1) },
              { key: 'down', label: 'Move down', icon: <VerticalAlignBottomOutlined />, disabled: index === steps.length - 1, onClick: () => onMove(1) },
              { type: 'divider' },
              { key: 'remove', label: 'Remove step', icon: <DeleteOutlined />, danger: true, onClick: onRemove },
            ],
          }}
        >
          <Button type="text" icon={<MoreOutlined />} aria-label={`Step ${index + 1} actions`} />
        </Dropdown>
      </Flex>
      {expanded && (
        <div style={{ padding: '4px 16px 16px 72px' }}>
          <ChainStepDetails step={step} steps={steps} action={action} onChange={onChange} />
        </div>
      )}
    </div>
  );
};

export default ChainStepRow;
