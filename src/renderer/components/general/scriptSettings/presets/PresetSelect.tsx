import { FC } from 'react';
import { Flex, Select, Typography } from 'antd';
import {
  DEFAULT_PRESET,
  pluginPresets,
} from '../../../../../common/pluginPresets';
import { useSettingsStore } from '../../../../redux/settings';

const CURRENT = '';

/**
 * Lets a chain step, schedule, cooldown or trigger pin one of a plugin's
 * presets. Unset follows the plugin's selected preset; renders nothing for
 * plugins without presets.
 */
const PresetSelect: FC<{
  pluginId: string;
  value?: string;
  onChange: (presetId?: string) => void;
}> = ({ pluginId, value, onChange }) => {
  const stored = useSettingsStore((state) => state.settings.scripts?.[pluginId]);
  const presets = pluginPresets(stored);
  if (!Object.keys(presets).length) return null;

  const missing = value && value !== DEFAULT_PRESET && !presets[value];
  return (
    <Flex vertical gap={4}>
      <Typography.Text type="secondary">Preset</Typography.Text>
      <Select
        aria-label="Preset"
        value={value ?? CURRENT}
        onChange={(presetId) => onChange(presetId || undefined)}
        options={[
          { value: CURRENT, label: 'Current preset' },
          { value: DEFAULT_PRESET, label: 'Default' },
          ...Object.entries(presets).map(([id, { name }]) => ({
            value: id,
            label: name,
          })),
          ...(missing ? [{ value, label: 'Deleted preset (uses Default)' }] : []),
        ]}
      />
    </Flex>
  );
};

export default PresetSelect;
