import React from 'react';
import { Button, Dropdown, Flex, Switch, Tag, Typography, theme } from 'antd';
import {
  EditOutlined,
  MoreOutlined,
  ShareAltOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  describeTrigger,
  TRIGGER_ACTION_TYPES,
  type Trigger,
} from '../../../common/triggers';
import type { AltTag } from '../../../main/src/types';
import {
  saveTrigger,
  selectActiveServerId,
  useSettingsStore,
} from '../../redux/settings';
import { openShareModal } from '../share/useShareTarget';
import { useShareUpdateAction } from '../share/useShareUpdateAction';
import {
  TRIGGER_ACTION_ICONS,
  TRIGGER_EVENT_ICONS,
  useOpenTrigger,
} from './triggerUi';

type Props = {
  trigger: Trigger;
  altTags: AltTag[];
  /** Extra info / controls rendered before the switch (e.g. last run, test). */
  extra?: React.ReactNode;
  compact?: boolean;
};

const targetLabel = (trigger: Trigger, altTags: AltTag[]) => {
  const names = [
    ...(trigger.tags ?? []).map(
      (id) => altTags.find((tag) => tag.id === id)?.name ?? 'Deleted tag',
    ),
    ...(trigger.alts ?? []),
  ];
  if (!names.length) return 'All bots';
  return names.length > 3
    ? `${names.slice(0, 3).join(', ')} +${names.length - 3}`
    : names.join(', ');
};

export default function TriggerRow({
  trigger,
  altTags,
  extra,
  compact,
}: Props) {
  const { token } = theme.useToken();
  const openTrigger = useOpenTrigger();
  const shareUpdate = useShareUpdateAction('trigger', trigger.id);
  const title = describeTrigger(trigger);

  return (
    <Flex
      align="center"
      gap={12}
      style={{
        padding: compact ? '10px 12px' : '12px 16px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        opacity: trigger.enabled ? 1 : 0.6,
      }}
    >
      <Flex
        align="center"
        justify="center"
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: token.borderRadiusLG,
          color: token.colorPrimary,
          background: token.colorPrimaryBg,
          fontSize: 16,
        }}
      >
        {TRIGGER_EVENT_ICONS[trigger.event]}
      </Flex>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Typography.Text strong ellipsis style={{ display: 'block' }}>
          {title}
        </Typography.Text>
        <Flex gap={4} wrap align="center" style={{ marginTop: 4 }}>
          {!compact && (
            <Typography.Text type="secondary" style={{ marginRight: 4 }}>
              {targetLabel(trigger, altTags)} →
            </Typography.Text>
          )}
          {trigger.actions.map((action, index) => (
            <Tag
              key={index}
              variant="filled"
              icon={TRIGGER_ACTION_ICONS[action.type]}
            >
              {TRIGGER_ACTION_TYPES[action.type].name}
            </Tag>
          ))}
        </Flex>
      </div>
      {extra}
      <Button
        type="text"
        icon={<EditOutlined />}
        aria-label={`Edit ${title}`}
        onClick={() => openTrigger(trigger)}
      />
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            {
              key: 'share',
              label: 'Share',
              icon: <ShareAltOutlined />,
              onClick: () =>
                openShareModal({
                  kind: 'trigger',
                  ref: trigger.id,
                  profileKey: selectActiveServerId(useSettingsStore.getState()),
                  title,
                }),
            },
            ...(shareUpdate
              ? [
                  {
                    key: 'share-update',
                    label: shareUpdate.label,
                    icon: <SyncOutlined />,
                    onClick: shareUpdate.run,
                  },
                ]
              : []),
          ],
        }}
      >
        <Button
          type="text"
          icon={<MoreOutlined />}
          aria-label={`More actions for ${title}`}
        />
      </Dropdown>
      <Switch
        size="small"
        aria-label={`${trigger.enabled ? 'Disable' : 'Enable'} ${title}`}
        checked={trigger.enabled}
        onChange={(enabled) => saveTrigger({ ...trigger, enabled })}
      />
    </Flex>
  );
}
