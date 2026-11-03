import React from 'react';
import { Button, Card, Dropdown, Flex, Progress, Tooltip, Typography, theme } from 'antd';
import {
  CalendarOutlined,
  CaretRightOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PauseOutlined,
  ReloadOutlined,
  ThunderboltFilled,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { formatDuration, reminderDueAt, repeatInterval, scheduleLabel, type Reminder } from '../../../../common/cooldowns';
import { toggleAutoStartCooldown } from '../../../redux/settings';

const { Text } = Typography;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const dueFormat: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

interface Props {
  reminder: Reminder;
  now: number;
  onEdit: (reminder: Reminder) => void;
  onRun: (reminder: Reminder) => void;
  onReset: (reminder: Reminder) => void;
  onDelete: (reminder: Reminder) => void;
}

const CooldownRow: React.FC<Props> = ({ reminder: c, now, onEdit, onRun, onReset, onDelete }) => {
  const { token } = theme.useToken();
  const scheduled = c.kind === 'schedule';
  const dueAt = reminderDueAt(c);
  const remaining = dueAt - now;
  const ready = !scheduled && remaining <= 0;
  const paused = scheduled && !c.autoStart;
  const length = scheduled ? repeatInterval(c.repeat) : c.cooldown;
  const percent = ready ? 100 : length > 0 ? Math.min(100, Math.max(0, 100 - (remaining / length) * 100)) : 0;

  const icon = ready ? <CheckOutlined /> : paused ? <PauseOutlined /> : scheduled ? <CalendarOutlined /> : <ClockCircleOutlined />;
  const subtitle = scheduled
    ? `${paused ? 'Paused · ' : ''}${scheduleLabel(c.repeat)}`
    : `Every ${formatDuration(c.cooldown)}`;
  const autoRunLabel = scheduled
    ? c.autoStart ? 'Pause schedule' : 'Resume schedule'
    : c.autoStart ? 'Auto-run is on' : 'Auto-run when ready';

  return (
    <Card size="small" onClick={() => onEdit(c)} style={{ cursor: 'pointer' }}>
      <Flex align="center" gap={12}>
        <Progress
          type="circle"
          size={36}
          percent={percent}
          status={ready ? 'success' : 'normal'}
          strokeColor={paused ? token.colorTextQuaternary : undefined}
          format={() => icon}
        />

        <Flex vertical flex={1} style={{ minWidth: 0 }}>
          <Text strong ellipsis>{c.name}</Text>
          <Text type="secondary" ellipsis style={{ fontSize: 12 }}>{subtitle}</Text>
        </Flex>

        {ready ? (
          <Tooltip title="Run script">

          <Button
            type="text"
            size="small"
            icon={<CaretRightOutlined />}
            onClick={(e) => {
              stop(e);
              onRun(c);
            }}
            />
            </Tooltip>
        ) : (
          <Flex vertical align="end" style={{ whiteSpace: 'nowrap' }}>
            <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
              {remaining <= 0 ? 'Due' : formatDuration(remaining)}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {new Date(dueAt).toLocaleString(undefined, dueFormat)}
            </Text>
          </Flex>
        )}

        <Flex onClick={stop}>
          <Tooltip title={autoRunLabel}>
            <Button
              type="text"
              aria-label={autoRunLabel}
              icon={c.autoStart ? <ThunderboltFilled style={{ color: token.colorPrimary }} /> : <ThunderboltOutlined />}
              onClick={() => toggleAutoStartCooldown(c.id)}
            />
          </Tooltip>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                ...(scheduled ? [] : [{ key: 'reset', icon: <ReloadOutlined />, label: 'Restart countdown' }]),
                { key: 'edit', icon: <EditOutlined />, label: 'Edit' },
                { type: 'divider' as const },
                { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true },
              ],
              onClick: ({ key }) => (key === 'reset' ? onReset : key === 'edit' ? onEdit : onDelete)(c),
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label={`More actions for ${c.name}`} />
          </Dropdown>
        </Flex>
      </Flex>
    </Card>
  );
};

export default CooldownRow;
