import { FC, useState, useEffect } from 'react';
import { Button, Empty, Typography, theme as antTheme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import type { Chain, ScriptActionInfo } from '../../../../main/src/types';
import { createChainStep, normalizeChainStep, type ChainNext, type ChainStep } from '../../../../common/chains';
import { groupActionOptions } from '../../../utils/actionOptions';
import ChainStepRow from './ChainStepRow';

type ChainFlowProps = {
  chain: Chain;
  onChange: (chain: Chain) => void;
};

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];

const ChainFlow: FC<ChainFlowProps> = ({ chain, onChange }) => {
  const [actions, setActions] = useState<ScriptActionInfo[]>([]);
  const [expandedId, setExpandedId] = useState<string>();
  const { token } = antTheme.useToken();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Load the available script actions once.
  useEffect(() => {
    window.ipcRenderer
      .get<ScriptActionInfo[]>('GET_SCRIPT_ACTIONS')
      .then((data) => setActions(data || []))
      .catch(() => setActions([]));
  }, []);

  const steps = chain.chains.map(normalizeChainStep);
  const save = (next: ChainStep[]) => onChange({ ...chain, chains: next });
  const setStep = (index: number, step: ChainStep) => save(steps.map((s, i) => (i === index ? step : s)));

  const addStep = () => {
    const step = createChainStep();
    save([...steps, step]);
    setExpandedId(undefined);
  };

  const removeStep = (index: number) => {
    const removed = `step:${steps[index].id}`;
    // Steps that jumped to the removed one continue instead.
    const clear = (next?: ChainNext) => (next === removed ? undefined : next);
    save(
      steps
        .filter((_, i) => i !== index)
        .map((s) => ({ ...s, onSuccess: clear(s.onSuccess), onFail: clear(s.onFail) })),
    );
  };

  const moveStep = (from: number, to: number) => save(arrayMove(steps, from, to));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    moveStep(
      steps.findIndex((s) => s.id === active.id),
      steps.findIndex((s) => s.id === over.id),
    );
  };

  const selectAction = (index: number, pluginId: string) => {
    const action = actions.find((a) => a.pluginId === pluginId);
    // Overrides belong to the previous action's options.
    setStep(index, { ...steps[index], scriptId: pluginId, name: action?.name ?? pluginId, options: undefined });
  };

  const actionOptions = groupActionOptions(actions);

  if (steps.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Add the actions every alt should run, in order."
        style={{ padding: 32 }}
      >
        <Button type="primary" icon={<PlusOutlined />} onClick={addStep}>
          Add first step
        </Button>
      </Empty>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          overflow: 'hidden',
        }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={MODIFIERS} onDragEnd={onDragEnd}>
          <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {steps.map((step, index) => (
              <ChainStepRow
                key={step.id}
                step={step}
                steps={steps}
                index={index}
                action={actions.find((a) => a.pluginId === step.scriptId)}
                actionOptions={actionOptions}
                expanded={expandedId === step.id}
                onToggle={() => setExpandedId(expandedId === step.id ? undefined : step.id)}
                onChange={(next) => setStep(index, next)}
                onSelectAction={(pluginId) => selectAction(index, pluginId)}
                onMove={(dir) => moveStep(index, index + dir)}
                onRemove={() => removeStep(index)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, padding: 4 }}>
          <Button type="text" block icon={<PlusOutlined />} onClick={addStep} style={{ justifyContent: 'flex-start' }}>
            Add step
          </Button>
        </div>
      </div>
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        Each alt runs these steps from top to bottom, then the chain continues with the next alt.
      </Typography.Text>
    </div>
  );
};

export default ChainFlow;
