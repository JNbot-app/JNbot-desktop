import { reminderDueAt, type Reminder, type ScriptCooldown, type ScriptSchedule } from '../../../common/cooldowns';
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Flex } from 'antd';
import useAppApi from '../../hooks/useAppApi';
import { useSettingsStore, selectSettings, selectScripts, removeCooldown, setCooldown } from '../../redux/settings';
import CooldownRow from './cooldowns/CooldownRow';
import EditCooldownModal from './cooldowns/EditCooldownModal';

interface Props {
  openSchedule: (schedule?: ScriptSchedule) => void;
  canSchedule: boolean;
}

const CooldownTimeline: React.FC<Props> = ({ openSchedule, canSchedule }) => {
  const reminders = useSettingsStore(selectSettings).reminders;
  const { modal } = useAppApi();
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<ScriptCooldown | null>(null);

  // Keep countdowns fresh without re-fetching settings.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const sorted = useMemo(
    () => [...(reminders ?? [])].sort((a: Reminder, b: Reminder) => reminderDueAt(a) - reminderDueAt(b)),
    [reminders],
  );

  if (!sorted.length) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cooldowns yet">
        <Button type="primary" onClick={() => openSchedule()} disabled={!canSchedule}>
          Schedule a script
        </Button>
      </Empty>
    );
  }

  const edit = (c: Reminder) => (c.kind === 'schedule' ? openSchedule(c) : setEditing(c));
  // Restart the countdown (claimed now → ready again after the cooldown).
  const reset = (c: Reminder) => c.kind !== 'schedule' && setCooldown({ ...c, time: Date.now() });
  // Same as an auto-run firing: start the script with the cooldown's options and restart the countdown.
  const run = (c: Reminder) => {
    if (c.kind === 'schedule') return;
    selectScripts(useSettingsStore.getState()).startScript({
      script: 'macro',
      arguments: { devMode: false, optionOverrides: c.options, macroInfo: { pluginId: c.pluginId } },
      console: 'macro_console',
    });
    setCooldown({ ...c, time: Date.now() });
  };
  const remove = (c: Reminder) =>
    modal.confirm({
      title: c.kind === 'schedule' ? 'Delete schedule' : 'Delete cooldown',
      content: `Remove "${c.name}"?`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => removeCooldown(c.id),
    });

  return (
    <Flex vertical gap={8} style={{ maxHeight: 500, overflowY: 'auto', overflowX: 'hidden' }}>
      {sorted.map((c: Reminder) => (
        <CooldownRow key={c.id} reminder={c} now={now} onEdit={edit} onRun={run} onReset={reset} onDelete={remove} />
      ))}
      <EditCooldownModal cooldown={editing} onClose={() => setEditing(null)} />
    </Flex>
  );
};

export default CooldownTimeline;
