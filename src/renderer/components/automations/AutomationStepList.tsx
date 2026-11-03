import React, { useEffect, useRef } from 'react';
import { Empty, theme } from 'antd';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AutomationStep } from '../../../common/automation';
import AutomationStepItem from './AutomationStepItem';

interface AutomationStepListProps {
  steps: AutomationStep[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<AutomationStep>) => void;
}

const AutomationStepList: React.FC<AutomationStepListProps> = ({
  steps,
  selectedId,
  onSelect,
  onDelete,
  onUpdate,
}) => {
  const { token } = theme.useToken();
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: steps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 46,
    getItemKey: (index) => steps[index]?.id ?? index,
    overscan: 8,
  });

  useEffect(() => {
    if (!selectedId || !parentRef.current) return;
    const index = steps.findIndex((step) => step.id === selectedId);
    if (index === -1) return;

    const visibleItems = rowVirtualizer.getVirtualItems();
    const isVisible = visibleItems.some((item) => item.index === index);
    if (!isVisible) {
      const rafId = requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(index, { align: 'auto' });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [selectedId, steps, rowVirtualizer]);

  if (steps.length === 0) {
    return (
      <Empty
        description="No replay steps. Record a take or add an action."
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <div
      ref={parentRef}
      style={{
        maxHeight: 560,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const step = steps[virtualRow.index];
          if (!step) return null;

          return (
            <div
              key={step.id}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: token.marginXS,
              }}
            >
              <AutomationStepItem
                step={step}
                isSelected={selectedId === step.id}
                onSelect={() => onSelect(step.id)}
                onDelete={() => onDelete(step.id)}
                onUpdate={(patch) => onUpdate(step.id, patch)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(AutomationStepList);
