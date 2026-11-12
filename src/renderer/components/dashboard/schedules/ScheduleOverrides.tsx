import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Collapse, Flex, Form, Input, Tag, Typography } from 'antd';
import { overrideValue, setOverride } from '../../../../common/cooldowns';
import {
  presetValues,
  PRESET_OPTION,
  selectedPresetId,
  withPreset,
} from '../../../../common/pluginPresets';
import type { MacroInfo } from '../../../../main/src/types';
import Option from '../../general/scriptSettings/SettingOptions/Option';
import PresetSelect from '../../general/scriptSettings/presets/PresetSelect';
import { useSettingsStore } from '../../../redux/settings';

export default function ScheduleOverrides({
  plugin,
  values,
  onChange,
  label = 'Script overrides',
  hint = 'Unchanged options use the script’s saved settings when it runs.',
}: {
  plugin: MacroInfo;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  label?: string;
  hint?: string;
}) {
  const [form] = Form.useForm();
  const stored = useSettingsStore(
    (state) => state.settings.scripts?.[plugin.pluginId],
  );
  const presetId = selectedPresetId(stored, values);
  const saved = useMemo(() => presetValues(stored, presetId), [stored, presetId]);
  const gamemodes = useSettingsStore((state) => {
    const key = state.selectedProfileKey ?? state.appSettings.server;
    return key ? state.JNdata.data[key]?.gamemodes : undefined;
  });
  const fields = plugin.config?.flatMap((section) => section.options) ?? [];
  useEffect(() => {
    const definitions =
      plugin.config?.flatMap((section) => section.options) ?? [];
    form.setFieldsValue(
      Object.fromEntries(
        definitions.map((option) => [
          option.id,
          overrideValue(option, definitions, saved, values),
        ]),
      ),
    );
  }, [form, plugin, saved, values]);
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<string[] | null>(null);
  if (!fields.length) return null;

  const isOverridden = (id: string) =>
    Object.prototype.hasOwnProperty.call(values, id);
  const query = search.trim().toLowerCase();
  const sections = (plugin.config ?? [])
    .map((section, index) => ({
      key: String(index),
      name: section.name || 'General',
      options: section.options.filter(
        (option) =>
          !query ||
          `${option.label ?? ''} ${option.id}`.toLowerCase().includes(query),
      ),
      changed: section.options.filter((option) => isOverridden(option.id))
        .length,
    }))
    .filter((section) => section.options.length);
  const changedCount = fields.filter((option) => isOverridden(option.id)).length;
  // Sections with changes start open; searching opens every match.
  const active = query
    ? sections.map((section) => section.key)
    : (openSections ??
      sections.filter((s) => s.changed).map((section) => section.key));

  const renderOption = (option: (typeof fields)[number]) => (
    <Flex key={option.id} vertical align="stretch">
      <Option
        option={
          option.type === 'gamemodeSelect'
            ? { ...option, gamemodes: option.gamemodes ?? gamemodes ?? [] }
            : option
        }
        value={overrideValue(option, fields, saved, values)}
        onChange={(value) =>
          onChange(setOverride(option, value, fields, saved, values))
        }
      />
      {isOverridden(option.id) && (
        <Button
          type="link"
          size="small"
          style={{ alignSelf: 'flex-start', paddingInline: 0 }}
          onClick={() => {
            const next = { ...values };
            delete next[option.id];
            onChange(next);
          }}
        >
          Use saved setting
        </Button>
      )}
    </Flex>
  );

  const body =
    sections.length === 1 ? (
      <Flex vertical gap={12}>
        {sections[0].options.map(renderOption)}
      </Flex>
    ) : (
      <Collapse
        size="small"
        activeKey={active}
        onChange={(keys) => setOpenSections([keys].flat().map(String))}
        items={sections.map((section) => ({
          key: section.key,
          label: (
            <Flex justify="space-between" align="center" gap={8}>
              <span>{section.name}</span>
              {section.changed > 0 && (
                <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                  {section.changed} changed
                </Tag>
              )}
            </Flex>
          ),
          children: (
            <Flex vertical gap={12}>
              {section.options.map(renderOption)}
            </Flex>
          ),
        }))}
      />
    );

  return (
    <Form form={form} component={false} layout="vertical">
      <Flex vertical gap={12}>
        <PresetSelect
          pluginId={plugin.pluginId}
          value={values[PRESET_OPTION] as string | undefined}
          onChange={(preset) => onChange(withPreset(values, preset))}
        />
        <Collapse
          items={[
            {
              key: 'overrides',
              label: (
                <Flex align="center" gap={8}>
                  {label}
                  {changedCount > 0 && <Badge count={changedCount} />}
                </Flex>
              ),
              extra: changedCount > 0 && (
                <Button
                  type="link"
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(withPreset({}, values[PRESET_OPTION] as string | undefined));
                  }}
                >
                  Reset all
                </Button>
              ),
              children: (
                <Flex vertical gap={12}>
                  <Typography.Text type="secondary">{hint}</Typography.Text>
                  {fields.length > 8 && (
                    <Input.Search
                      allowClear
                      placeholder="Search options"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  )}
                  {body}
                  {query && !sections.length && (
                    <Typography.Text type="secondary">
                      No options match “{search}”.
                    </Typography.Text>
                  )}
                </Flex>
              ),
            },
          ]}
        />
      </Flex>
    </Form>
  );
}
