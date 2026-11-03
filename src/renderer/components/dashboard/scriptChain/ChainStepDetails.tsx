import { FC } from 'react';
import { Flex, Form, Select, Typography } from 'antd';
import type { ScriptActionInfo } from '../../../../main/src/types';
import { CHAIN_NEXT_CHOICES, type ChainNext, type ChainStep } from '../../../../common/chains';
import ScheduleOverrides from '../schedules/ScheduleOverrides';

const PLACEHOLDER_HINT =
  'Unchanged options use the action’s saved settings. Type {alt} to insert the alt’s name, or {name} for a value an earlier step returned.';

type Props = {
  step: ChainStep;
  steps: ChainStep[];
  action?: ScriptActionInfo;
  onChange: (step: ChainStep) => void;
};

/** What happens after a step, and its option overrides. Edits apply right away. */
const ChainStepDetails: FC<Props> = ({ step, steps, action, onChange }) => {
  const nextOptions = [
    { label: 'Then', options: CHAIN_NEXT_CHOICES },
    {
      label: 'Go to step',
      options: steps.map((s, i) => ({ value: `step:${s.id}`, label: `Step ${i + 1} · ${s.name}` })),
    },
  ];
  const nextField = (field: 'onSuccess' | 'onFail', label: string, tooltip?: string) => (
    <Form.Item label={label} tooltip={tooltip} style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
      <Select<ChainNext>
        value={step[field] ?? 'next'}
        options={nextOptions}
        onChange={(value) => onChange({ ...step, [field]: value === 'next' ? undefined : value })}
      />
    </Form.Item>
  );
  const hasOptions = !!action?.config?.some((section) => section.options.length);

  return (
    <Flex vertical gap={16}>
      <Form layout="vertical" component={false}>
        <Flex gap={12} wrap>
          {nextField('onSuccess', 'If it works')}
          {nextField('onFail', 'If it fails', 'The action stopped with an error, or the action itself reported that it failed.')}
        </Flex>
      </Form>
      {action && hasOptions ? (
        <ScheduleOverrides
          plugin={action}
          values={step.options ?? {}}
          onChange={(options) =>
            onChange({ ...step, options: Object.keys(options).length ? options : undefined })
          }
          label="Action options"
          hint={PLACEHOLDER_HINT}
        />
      ) : (
        <Typography.Text type="secondary">
          {action ? 'This action has no options to change.' : 'Choose an action to change its options.'}
        </Typography.Text>
      )}
    </Flex>
  );
};

export default ChainStepDetails;
