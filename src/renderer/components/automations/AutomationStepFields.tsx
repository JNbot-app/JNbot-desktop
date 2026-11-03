import { Form, Input, InputNumber, Switch } from 'antd';
import type { AutomationStep } from '../../../common/automation';
import AutomationActionFields from './AutomationActionFields';

interface AutomationStepFieldsProps {
  step: AutomationStep;
  onUpdate: (patch: Partial<AutomationStep>) => void;
}

/** The selected step's timing and parameters, edited in place. */
export default function AutomationStepFields({
  step,
  onUpdate,
}: AutomationStepFieldsProps) {
  return (
    <Form layout="vertical" size="small">
      <Form.Item label="Enabled">
        <Switch
          checked={step.enabled}
          onChange={(enabled) => onUpdate({ enabled })}
        />
      </Form.Item>
      <Form.Item label="Label">
        <Input
          value={step.label ?? ''}
          placeholder="Optional custom label"
          allowClear
          onChange={(event) => onUpdate({ label: event.target.value })}
        />
      </Form.Item>
      <Form.Item label="Starts at">
        <InputNumber
          min={0}
          value={step.atMs}
          suffix="ms"
          onChange={(atMs) => onUpdate({ atMs: atMs ?? 0 })}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item label="Parameters" style={{ marginBottom: 0 }}>
        <AutomationActionFields step={step} update={onUpdate} />
      </Form.Item>
    </Form>
  );
}
