import React, { useEffect, useState } from 'react';
import { DatePicker, Form, Input, Modal } from 'antd';
import dayjs from 'dayjs';
import { withEditedOptions, type ScriptCooldown } from '../../../../common/cooldowns';
import { PRESET_OPTION, withPreset } from '../../../../common/pluginPresets';
import { useRunnableScripts } from '../../../hooks/useRunnableScripts';
import { setCooldown } from '../../../redux/settings';
import PresetSelect from '../../general/scriptSettings/presets/PresetSelect';
import ScheduleOverrides from '../schedules/ScheduleOverrides';
import DurationFields from './DurationFields';

type Options = Record<string, unknown>;

/** Unavailable plugins have no option definitions, so only their preset can change. */
const CooldownOverrides: React.FC<{ pluginId: string; values: Options; onChange: (next: Options) => void }> = ({
  pluginId,
  values,
  onChange,
}) => {
  const { scripts } = useRunnableScripts();
  const plugin = scripts.find((script) => script.info.pluginId === pluginId)?.info;
  if (plugin) return <ScheduleOverrides plugin={plugin} values={values} onChange={onChange} />;
  return (
    <PresetSelect
      pluginId={pluginId}
      value={values[PRESET_OPTION] as string | undefined}
      onChange={(preset) => onChange(withPreset(values, preset))}
    />
  );
};

const EditCooldownModal: React.FC<{ cooldown: ScriptCooldown | null; onClose: () => void }> = ({
  cooldown,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [cooldownMs, setCooldownMs] = useState(0);
  const [readyAt, setReadyAt] = useState(() => dayjs());
  const [options, setOptions] = useState<Options>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cooldown) return;
    setName(cooldown.name);
    setCooldownMs(cooldown.cooldown);
    setReadyAt(dayjs(cooldown.time + cooldown.cooldown));
    setOptions(cooldown.options ?? {});
    setError(null);
  }, [cooldown]);

  const save = () => {
    if (!cooldown) return;
    const trimmed = name.trim();
    if (!trimmed) return setError('Name is required');
    if (trimmed.length > 60) return setError('Name must be 60 characters or fewer');
    if (cooldownMs <= 0) return setError('Cooldown must be at least 1 minute');

    setCooldown({
      ...withEditedOptions(cooldown, options),
      name: trimmed,
      cooldown: cooldownMs,
      time: readyAt.valueOf() - cooldownMs,
    });
    onClose();
  };

  return (
    <Modal open={!!cooldown} onCancel={onClose} onOk={save} okText="Save" title="Edit cooldown">
      <Form layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item label="Name" validateStatus={error ? 'error' : undefined} help={error}>
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
        </Form.Item>
        <Form.Item label="Cooldown">
          <DurationFields value={cooldownMs} onChange={setCooldownMs} />
        </Form.Item>
        <Form.Item label="Ready on" style={{ marginBottom: 0 }}>
          <DatePicker showTime value={readyAt} onChange={(d) => d && setReadyAt(d)} allowClear={false} style={{ width: '100%' }} />
        </Form.Item>
        {cooldown && (
          <div style={{ marginTop: 16 }}>
            <CooldownOverrides pluginId={cooldown.pluginId} values={options} onChange={setOptions} />
          </div>
        )}
      </Form>
    </Modal>
  );
};

export default EditCooldownModal;
