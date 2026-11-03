import { Form, Input, InputNumber, Select, Space } from 'antd';
import {
  TRIGGER_EVENT_IDS,
  TRIGGER_EVENTS,
  type Trigger,
  type TriggerEvent,
} from '../../../common/triggers';
import { TRIGGER_EVENT_ICONS } from './triggerUi';

const EVENT_OPTIONS = TRIGGER_EVENT_IDS.map((event) => ({
  value: event,
  title: TRIGGER_EVENTS[event].name,
  label: (
    <Space>
      {TRIGGER_EVENT_ICONS[event]}
      {TRIGGER_EVENTS[event].name}
    </Space>
  ),
}));

function FilterInput({
  draft,
  onChange,
}: {
  draft: Trigger;
  onChange: (filter: string) => void;
}) {
  const filter = TRIGGER_EVENTS[draft.event].filter!;
  if (filter.kind === 'number')
    return (
      <InputNumber
        id="trigger-filter"
        min={1}
        max={20}
        precision={0}
        placeholder={filter.placeholder}
        value={draft.filter ? Number(draft.filter) : null}
        onChange={(value) => onChange(value ? String(value) : '')}
        suffix="HP"
        style={{ width: '100%' }}
      />
    );
  if (filter.kind === 'players')
    return (
      <Select
        id="trigger-filter"
        mode="tags"
        tokenSeparators={[',', ' ']}
        open={false}
        suffixIcon={null}
        placeholder={filter.placeholder}
        value={draft.filter ? draft.filter.split(',') : []}
        onChange={(names: string[]) => onChange(names.join(','))}
      />
    );
  return (
    <Input
      id="trigger-filter"
      allowClear
      placeholder={filter.placeholder}
      value={draft.filter}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** "When" section: the event and its optional condition. */
export default function TriggerEventFields({
  draft,
  onEventChange,
  onFilterChange,
}: {
  draft: Trigger;
  onEventChange: (event: TriggerEvent) => void;
  onFilterChange: (filter: string) => void;
}) {
  const event = TRIGGER_EVENTS[draft.event];
  return (
    <>
      <Form.Item
        label="Event"
        htmlFor="trigger-event"
        extra={event.description}
      >
        <Select
          id="trigger-event"
          value={draft.event}
          options={EVENT_OPTIONS}
          onChange={onEventChange}
        />
      </Form.Item>
      {event.filter && (
        <Form.Item
          label={event.filter.label}
          htmlFor="trigger-filter"
          style={{ marginBottom: 0 }}
        >
          <FilterInput draft={draft} onChange={onFilterChange} />
        </Form.Item>
      )}
    </>
  );
}
