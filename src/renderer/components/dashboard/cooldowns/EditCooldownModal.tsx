import React, { useEffect, useState } from 'react';
import { DatePicker, Flex, Form, Input, InputNumber, Modal } from 'antd';
import dayjs from 'dayjs';
import type { ScriptCooldown } from '../../../../common/cooldowns';
import { setCooldown } from '../../../redux/settings';
import { DAY, HOUR, MINUTE } from './CooldownRow';

const EditCooldownModal: React.FC<{ cooldown: ScriptCooldown | null; onClose: () => void }> = ({
  cooldown,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [days, setDays] = useState(0);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [readyAt, setReadyAt] = useState(() => dayjs());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cooldown) return;
    setName(cooldown.name);
    setDays(Math.floor(cooldown.cooldown / DAY));
    setHours(Math.floor((cooldown.cooldown % DAY) / HOUR));
    setMinutes(Math.round((cooldown.cooldown % HOUR) / MINUTE));
    setReadyAt(dayjs(cooldown.time + cooldown.cooldown));
    setError(null);
  }, [cooldown]);

  const save = () => {
    if (!cooldown) return;
    const trimmed = name.trim();
    if (!trimmed) return setError('Name is required');
    if (trimmed.length > 60) return setError('Name must be 60 characters or fewer');

    const cooldownMs = days * DAY + hours * HOUR + minutes * MINUTE;
    if (cooldownMs <= 0) return setError('Cooldown must be at least 1 minute');

    setCooldown({ ...cooldown, name: trimmed, cooldown: cooldownMs, time: readyAt.valueOf() - cooldownMs });
    onClose();
  };

  const durationField = (value: number, onChange: (v: number) => void, suffix: string, max?: number) => (
    <InputNumber
      min={0}
      max={max}
      precision={0}
      value={value}
      onChange={(v) => onChange(v ?? 0)}
      suffix={suffix}
      style={{ flex: 1 }}
    />
  );

  return (
    <Modal open={!!cooldown} onCancel={onClose} onOk={save} okText="Save" title="Edit cooldown">
      <Form layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item label="Name" validateStatus={error ? 'error' : undefined} help={error}>
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
        </Form.Item>
        <Form.Item label="Cooldown">
          <Flex gap={8}>
            {durationField(days, setDays, 'days')}
            {durationField(hours, setHours, 'hrs', 23)}
            {durationField(minutes, setMinutes, 'min', 59)}
          </Flex>
        </Form.Item>
        <Form.Item label="Ready on" style={{ marginBottom: 0 }}>
          <DatePicker showTime value={readyAt} onChange={(d) => d && setReadyAt(d)} allowClear={false} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default EditCooldownModal;
