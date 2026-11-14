import type { SchedulePanelData } from 'renderer/components/other/botSideBar/panelTabs';
import { useState } from 'react';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import {
  DAY,
  presetRepeat,
  REPEAT_CHOICES,
  repeatInterval,
  repeatPreset,
  scheduleError,
  type RepeatPreset,
  type ScriptSchedule,
} from '../../../../common/cooldowns';
import {
  addSchedule,
  selectCanUseAccounts,
  setCooldown,
  useSettingsStore,
} from '../../../redux/settings';
import { usePanelContext } from '../../other/botSideBar/SidePanelContextProvider';
import { useRunnableScripts } from '../../../hooks/useRunnableScripts';
import DurationFields from '../cooldowns/DurationFields';
import ScheduleOverrides from './ScheduleOverrides';
import ScriptSelect from '../../general/scriptSettings/ScriptSelect';

export default function ScheduleEditor({ schedule }: SchedulePanelData) {
  const { setPanel } = usePanelContext();
  const { scripts, loading } = useRunnableScripts();
  const canUseAccounts = useSettingsStore(selectCanUseAccounts);
  const [name, setName] = useState(schedule?.name ?? '');
  const [pluginId, setPluginId] = useState(schedule?.pluginId ?? '');
  const [nextRunAt, setNextRunAt] = useState(() =>
    dayjs(
      schedule?.nextRunAt ??
        Math.ceil((Date.now() + 3_600_000) / 60_000) * 60_000,
    ),
  );
  const [preset, setPreset] = useState<RepeatPreset>(
    repeatPreset(schedule?.repeat),
  );
  const [customRepeat, setCustomRepeat] = useState(
    repeatInterval(schedule?.repeat) || DAY,
  );
  const [enabled, setEnabled] = useState(schedule?.autoStart ?? true);
  const [options, setOptions] = useState<Record<string, unknown>>(
    schedule?.options ?? {},
  );
  const [error, setError] = useState<string>();
  const selected = scripts.find((script) => script.info.pluginId === pluginId);
  const close = () =>
    setPanel((current) => ({ ...current, active: false, data: undefined }));
  const save = () => {
    const next: ScriptSchedule = {
      kind: 'schedule',
      id: schedule?.id ?? crypto.randomUUID(),
      name: name.trim(),
      pluginId,
      nextRunAt: nextRunAt.valueOf(),
      autoStart: enabled,
      repeat: presetRepeat(preset, customRepeat),
      options: Object.keys(options).length ? options : undefined,
    };
    const validation = scheduleError(next);
    if (validation || !selected)
      return setError(validation ?? 'Choose an available script.');
    if (schedule) {
      const current = useSettingsStore
        .getState()
        .settings.reminders.find((entry) => entry.id === schedule.id);
      if (!current)
        return setError(
          'This schedule has expired or was deleted. Create a new schedule.',
        );
      setCooldown(next);
    } else addSchedule(next);
    close();
  };

  return (
    <Form layout="vertical" onFinish={save}>
      <Form.Item label="Script" htmlFor="schedule-script" required>
        <ScriptSelect
          id="schedule-script"
          scripts={scripts}
          loading={loading}
          value={pluginId || undefined}
          placeholder="Choose a script"
          onChange={(next) => {
            const id = next as string;
            setPluginId(id);
            setOptions({});
            setError(undefined);
            if (!name)
              setName(
                scripts.find((script) => script.info.pluginId === id)?.info
                  .name ?? '',
              );
          }}
        />
      </Form.Item>
      <Form.Item label="Name" htmlFor="schedule-name" required>
        <Input
          id="schedule-name"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
      </Form.Item>
      <Form.Item label="Next run" htmlFor="schedule-date" required>
        <DatePicker
          id="schedule-date"
          showTime={{ format: 'HH:mm' }}
          format="YYYY-MM-DD HH:mm"
          allowClear={false}
          value={nextRunAt}
          onChange={(value) => value && setNextRunAt(value)}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item label="Repeat" htmlFor="schedule-repeat">
        <Select
          id="schedule-repeat"
          value={preset}
          options={REPEAT_CHOICES}
          onChange={setPreset}
        />
      </Form.Item>
      {preset === 'custom' && (
        <Form.Item label="Run every">
          <DurationFields value={customRepeat} onChange={setCustomRepeat} />
        </Form.Item>
      )}
      <Form.Item label="Enabled">
        <Switch
          aria-label="Schedule enabled"
          checked={enabled}
          onChange={setEnabled}
        />
      </Form.Item>
      {selected && (
        <ScheduleOverrides
          key={pluginId}
          plugin={selected.info}
          values={options}
          onChange={setOptions}
        />
      )}
      {error && (
        <Typography.Paragraph type="danger" role="alert">
          {error}
        </Typography.Paragraph>
      )}
      <br />
      <Space>
        <Button onClick={close}>Cancel</Button>
        <Button
          type="primary"
          htmlType="submit"
          disabled={loading || !canUseAccounts}
        >
          {schedule ? 'Save schedule' : 'Schedule script'}
        </Button>
      </Space>
    </Form>
  );
}
