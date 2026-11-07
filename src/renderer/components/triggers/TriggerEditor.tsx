import { useState } from 'react';
import {
  Button,
  Collapse,
  Flex,
  Form,
  Input,
  InputNumber,
  Space,
  Switch,
  Typography,
} from 'antd';
import {
  describeTrigger,
  newTrigger,
  TRIGGER_EVENTS,
  triggerProblem,
  type Trigger,
  type TriggerEvent,
} from '../../../common/triggers';
import {
  deleteTrigger,
  saveTrigger,
  useSettingsStore,
} from '../../redux/settings';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import type { TriggerPanelData } from '../other/botSideBar/panelTabs';
import TagsSelectOption from '../general/scriptSettings/SettingOptions/TagsSelectOption';
import AltsSelectOption from '../general/scriptSettings/SettingOptions/AltsSelectOption';
import TriggerActionsField from './TriggerActionsField';
import TriggerEventFields from './TriggerEventFields';
import LlmPrompt from '../llm/LlmPrompt';

const TAGS_OPTION = { id: 'tags', label: 'Tags', type: 'tagsSelect' } as const;
const ALTS_OPTION = {
  id: 'alts',
  label: 'Accounts',
  type: 'altsSelect',
} as const;

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

export default function TriggerEditor({ trigger }: TriggerPanelData) {
  const { setPanel } = usePanelContext();
  const [draft, setDraft] = useState<Trigger>(
    () => trigger ?? newTrigger(crypto.randomUUID()),
  );
  const [error, setError] = useState<string | null>(null);
  const exists = useSettingsStore((s) =>
    Boolean(s.settings.triggers?.some((t) => t.id === draft.id)),
  );
  const generate = async (description: string) => {
    const generated = await window.ipcRenderer.get('LLM_GENERATE', { kind: 'trigger', description });
    setDraft({ ...(generated as Trigger), id: draft.id });
    setError(null);
  };
  const event = TRIGGER_EVENTS[draft.event];
  const autoName = describeTrigger({ ...draft, name: undefined });
  const targets = (draft.tags?.length ?? 0) + (draft.alts?.length ?? 0);

  const update = (patch: Partial<Trigger>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };
  // Follow the new event's default cooldown unless the user changed it.
  const changeEvent = (next: TriggerEvent) =>
    update({
      event: next,
      filter: undefined,
      cooldown:
        (draft.cooldown ?? 0) === (event.cooldown ?? 0)
          ? TRIGGER_EVENTS[next].cooldown ?? 0
          : draft.cooldown,
    });
  const close = () =>
    setPanel((current) => ({ ...current, active: false, data: undefined }));
  const save = () => {
    const next = { ...draft, name: draft.name?.trim() || undefined };
    const problem = triggerProblem(next);
    if (problem) return setError(problem);
    saveTrigger(next);
    close();
  };

  return (
    <Form
      layout="vertical"
      onFinish={save}
      initialValues={{ tags: draft.tags ?? [], alts: draft.alts ?? [] }}
    >
      {!exists && (
        <div style={{ marginBottom: 16 }}>
          <LlmPrompt
            placeholder="Describe it, e.g. post to Discord when a bot dies"
            onSubmit={generate}
          />
        </div>
      )}
      <Collapse
        style={{ marginBottom: 16 }}
        defaultActiveKey={['event', 'actions']}
        items={[
          {
            key: 'event',
            label: `When: ${event.name}`,
            children: (
              <TriggerEventFields
                draft={draft}
                onEventChange={changeEvent}
                onFilterChange={(filter) => update({ filter })}
              />
            ),
          },
          {
            key: 'actions',
            label: `Do: ${plural(draft.actions.length, 'action')}`,
            children: (
              <TriggerActionsField
                actions={draft.actions}
                vars={event.vars}
                onChange={(actions) => update({ actions })}
              />
            ),
          },
          {
            key: 'bots',
            label: `Bots: ${targets ? plural(targets, 'selection') : 'all bots'}`,
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  Leave both empty to run on every bot.
                </Typography.Paragraph>
                <TagsSelectOption
                  option={TAGS_OPTION}
                  value={draft.tags ?? []}
                  onChange={(tags) => update({ tags: tags as string[] })}
                />
                <AltsSelectOption
                  option={ALTS_OPTION}
                  value={draft.alts ?? []}
                  onChange={(alts) => update({ alts: alts as string[] })}
                />
              </>
            ),
          },
          {
            key: 'settings',
            label: 'Settings',
            children: (
              <>
                <Form.Item label="Name" htmlFor="trigger-name">
                  <Input
                    id="trigger-name"
                    maxLength={60}
                    placeholder={autoName}
                    value={draft.name ?? autoName}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </Form.Item>
                <Form.Item
                  label="Cooldown"
                  htmlFor="trigger-cooldown"
                  extra="Minimum time between two runs on the same bot."
                >
                  <InputNumber
                    id="trigger-cooldown"
                    min={0}
                    precision={0}
                    suffix="sec"
                    value={draft.cooldown ?? 0}
                    onChange={(cooldown) => update({ cooldown: cooldown ?? 0 })}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                <Form.Item label="Enabled" style={{ marginBottom: 0 }}>
                  <Switch
                    aria-label="Trigger enabled"
                    checked={draft.enabled}
                    onChange={(enabled) => update({ enabled })}
                  />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
      {error && (
        <Typography.Paragraph type="danger" role="alert">
          {error}
        </Typography.Paragraph>
      )}
      <Flex justify="space-between">
        <Space>
          <Button onClick={close}>Cancel</Button>
          <Button type="primary" htmlType="submit">
            {exists ? 'Save trigger' : 'Add trigger'}
          </Button>
        </Space>
        {exists && (
          <Button
            danger
            onClick={() => {
              deleteTrigger(draft.id);
              close();
            }}
          >
            Delete
          </Button>
        )}
      </Flex>
    </Form>
  );
}
