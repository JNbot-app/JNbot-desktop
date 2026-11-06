import { useEffect, useMemo } from 'react';
import { Button, Collapse, Flex, Form, Typography } from 'antd';
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
  if (!fields.length) return null;
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
              label,
              children: (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  <Typography.Text type="secondary">{hint}</Typography.Text>
                  {fields.map((option) => (
                    <div key={option.id}>
                      <Option
                        option={
                          option.type === 'gamemodeSelect'
                            ? {
                                ...option,
                                gamemodes: option.gamemodes ?? gamemodes ?? [],
                              }
                            : option
                        }
                        value={overrideValue(option, fields, saved, values)}
                        onChange={(value) =>
                          onChange(
                            setOverride(option, value, fields, saved, values),
                          )
                        }
                      />
                      {Object.prototype.hasOwnProperty.call(
                        values,
                        option.id,
                      ) && (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => {
                            const next = { ...values };
                            delete next[option.id];
                            onChange(next);
                          }}
                        >
                          Use saved setting
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      </Flex>
    </Form>
  );
}
