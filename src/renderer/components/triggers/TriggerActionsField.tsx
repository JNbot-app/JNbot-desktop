import { useEffect, useState } from 'react';
import { Button, Card, Dropdown, Flex, Input, Select, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ScriptActionInfo } from '../../../main/src/types';
import {
  newTriggerAction,
  TRIGGER_ACTION_TYPES,
  type TriggerAction,
  type TriggerActionType,
} from '../../../common/triggers';
import { groupActionOptions } from '../../utils/actionOptions';
import SelectFolder from '../other/SelectFolder';
import PresetSelect from '../general/scriptSettings/presets/PresetSelect';
import { TRIGGER_ACTION_ICONS } from './triggerUi';

type Props = {
  actions: TriggerAction[];
  /** Placeholders the chosen event offers, shown as a hint for chat messages. */
  vars: readonly string[];
  onChange: (actions: TriggerAction[]) => void;
};

const useScriptActions = (enabled: boolean) => {
  const [actions, setActions] = useState<ScriptActionInfo[] | null>(null);
  useEffect(() => {
    if (!enabled || actions) return undefined;
    let cancelled = false;
    window.ipcRenderer
      .get<ScriptActionInfo[]>('GET_SCRIPT_ACTIONS')
      .catch(() => [])
      .then((result) => !cancelled && setActions(result));
    return () => {
      cancelled = true;
    };
  }, [enabled, actions]);
  return actions;
};

function ActionField({
  action,
  index,
  vars,
  scriptActions,
  onChange,
}: {
  action: TriggerAction;
  index: number;
  vars: readonly string[];
  scriptActions: ScriptActionInfo[] | null;
  onChange: (action: TriggerAction) => void;
}) {
  switch (action.type) {
    case 'discord':
      return (
        <Input
          aria-label="Discord webhook URL"
          value={action.webhook}
          placeholder="https://discord.com/api/webhooks/..."
          onChange={(e) => onChange({ ...action, webhook: e.target.value })}
        />
      );
    case 'chat':
      return (
        <Input
          aria-label="Chat message"
          value={action.message}
          maxLength={256}
          placeholder={
            vars.length ? `e.g. /msg {${vars[0]}} hello` : 'Message or /command'
          }
          onChange={(e) => onChange({ ...action, message: e.target.value })}
        />
      );
    case 'scriptAction':
      return (
        <Flex vertical gap={8}>
          <Select
            aria-label="Script action"
            showSearch
            optionFilterProp="label"
            loading={scriptActions === null}
            value={action.id || undefined}
            options={groupActionOptions(scriptActions ?? [])}
            placeholder="Choose a script action"
            onChange={(id: string) => onChange({ type: action.type, id })}
            style={{ width: '100%' }}
          />
          <PresetSelect
            pluginId={action.id}
            value={action.preset}
            onChange={(preset) => onChange({ ...action, preset })}
          />
        </Flex>
      );
    case 'log':
      return (
        <SelectFolder
          id={`trigger-log-${index}`}
          label=""
          value={action.directory}
          onChange={(directory) => onChange({ ...action, directory })}
        />
      );
    default:
      return null;
  }
}

export default function TriggerActionsField({
  actions,
  vars,
  onChange,
}: Props) {
  const scriptActions = useScriptActions(
    actions.some((action) => action.type === 'scriptAction'),
  );
  const update = (index: number, action: TriggerAction) =>
    onChange(actions.map((current, i) => (i === index ? action : current)));

  return (
    <Flex vertical gap={8}>
      {actions.map((action, index) => {
        const meta = TRIGGER_ACTION_TYPES[action.type];
        return (
          <Card key={index} size="small">
            <Flex
              align="center"
              gap={8}
              style={{ marginBottom: action.type === 'notification' ? 0 : 8 }}
            >
              {TRIGGER_ACTION_ICONS[action.type]}
              <Typography.Text strong style={{ flex: 1 }}>
                {meta.name}
              </Typography.Text>
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                aria-label={`Remove ${meta.name}`}
                onClick={() => onChange(actions.filter((_, i) => i !== index))}
              />
            </Flex>
            <ActionField
              action={action}
              index={index}
              vars={vars}
              scriptActions={scriptActions}
              onChange={(next) => update(index, next)}
            />
          </Card>
        );
      })}
      <Dropdown
        trigger={['click']}
        menu={{
          items: (Object.keys(TRIGGER_ACTION_TYPES) as TriggerActionType[]).map(
            (type) => ({
              key: type,
              icon: TRIGGER_ACTION_ICONS[type],
              label: TRIGGER_ACTION_TYPES[type].name,
              extra: TRIGGER_ACTION_TYPES[type].description,
            }),
          ),
          onClick: ({ key }) =>
            onChange([...actions, newTriggerAction(key as TriggerActionType)]),
        }}
      >
        <Button type="dashed" icon={<PlusOutlined />} block>
          Add action
        </Button>
      </Dropdown>
      {actions.some((action) => action.type === 'chat') && (
        <Typography.Text type="secondary">
          Placeholders: {['bot', ...vars].map((v) => `{${v}}`).join(' ')}
        </Typography.Text>
      )}
    </Flex>
  );
}
