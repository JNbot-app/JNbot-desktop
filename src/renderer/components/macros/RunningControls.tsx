import { FC, useState } from 'react';
import { Button, Dropdown, Space, Tooltip } from 'antd';
import type { ButtonProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  DEFAULT_PRESET,
  MAX_SCRIPT_INSTANCES,
  pluginPresets,
} from '../../../common/pluginPresets';
import { selectScripts, useSettingsStore } from '../../redux/settings';

/**
 * Shown instead of the Run button while a plugin runs: stop it, or start
 * another instance. With several instances Stop asks which one; with presets
 * the plus button asks which preset to run.
 */
const RunningControls: FC<{
  pluginId: string;
  name?: string;
  stopLabel?: string;
  /** Styling of both buttons, e.g. their `size` and `type`. */
  buttonProps?: ButtonProps;
  stopIcon?: ButtonProps['icon'];
}> = ({ pluginId, name, stopLabel = 'Stop', buttonProps, stopIcon }) => {
  const scripts = useSettingsStore(selectScripts);
  const stored = useSettingsStore((state) => state.settings.scripts?.[pluginId]);
  const [starting, setStarting] = useState(false);
  const instances = scripts.getInstancesById(pluginId);
  const presetEntries = Object.entries(pluginPresets(stored));

  const runAnother = async (presetId?: string) => {
    setStarting(true);
    try {
      await scripts.runPlugin({ name, pluginId }, presetId);
    } finally {
      setStarting(false);
    }
  };

  const stopButton = (
    <Button
      {...buttonProps}
      type={buttonProps?.type ?? 'primary'}
      danger
      icon={stopIcon}
      aria-label={stopLabel || 'Stop'}
      onClick={
        instances.length === 1
          ? () => scripts.stop(instances[0].instanceId)
          : undefined
      }
    >
      {stopLabel && (instances.length > 1 ? `${stopLabel} (${instances.length})` : stopLabel)}
    </Button>
  );
  const addButton = (
    <Button
      {...buttonProps}
      type={buttonProps?.type === 'primary' ? 'default' : buttonProps?.type}
      icon={<PlusOutlined />}
      aria-label="Run another instance"
      loading={starting}
      disabled={instances.length >= MAX_SCRIPT_INSTANCES}
      onClick={presetEntries.length ? undefined : () => runAnother()}
    />
  );

  return (
    <span onClick={(event) => event.stopPropagation()}>
      <Space.Compact>
        {instances.length > 1 ? (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                ...instances.map(({ instanceId, presetName }, index) => ({
                  key: instanceId,
                  label: `Stop ${index + 1}. ${presetName ?? 'Default'}`,
                  onClick: () => scripts.stop(instanceId),
                })),
                { type: 'divider' as const },
                {
                  key: 'all',
                  label: 'Stop all',
                  danger: true,
                  onClick: () => scripts.stopByScriptId(pluginId),
                },
              ],
            }}
          >
            {stopButton}
          </Dropdown>
        ) : (
          stopButton
        )}
        {presetEntries.length ? (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  type: 'group',
                  label: 'Run another instance with',
                  children: [
                    { key: DEFAULT_PRESET, label: 'Default' },
                    ...presetEntries.map(([key, preset]) => ({
                      key,
                      label: preset.name,
                    })),
                  ],
                },
              ],
              onClick: ({ key }) => runAnother(key),
            }}
          >
            {addButton}
          </Dropdown>
        ) : (
          <Tooltip title="Run another instance">{addButton}</Tooltip>
        )}
      </Space.Compact>
    </span>
  );
};

export default RunningControls;
