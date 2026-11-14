import { FC } from 'react';
import { Button, Dropdown, Flex, Input, Select, Space, Tooltip } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  DEFAULT_PRESET,
  pluginPresets,
  selectedPresetId,
} from '../../../../../common/pluginPresets';
import {
  createPluginPreset,
  deletePluginPreset,
  renamePluginPreset,
  selectPluginPreset,
  useSettingsStore,
} from '../../../../redux/settings';
import useAppApi from '../../../../hooks/useAppApi';

/**
 * Switches between a plugin's presets above its options. Stays a single quiet
 * button until the user creates a preset.
 */
const PresetBar: FC<{ pluginId: string }> = ({ pluginId }) => {
  const { modal } = useAppApi();
  const stored = useSettingsStore((state) => state.settings.scripts?.[pluginId]);
  const presets = pluginPresets(stored);
  const selected = selectedPresetId(stored);
  const current = presets[selected];

  const askName = (title: string, initial: string, save: (name: string) => void) => {
    let name = initial;
    const submit = async () => {
      if (!name.trim()) throw new Error('A preset needs a name');
      save(name.trim());
    };
    const dialog = modal.confirm({
      title,
      icon: null,
      content: (
        <Input
          autoFocus
          aria-label="Preset name"
          maxLength={40}
          defaultValue={initial}
          placeholder="e.g. Alts 11-20"
          onChange={(event) => {
            name = event.target.value;
          }}
          onPressEnter={() => submit().then(dialog.destroy, () => {})}
        />
      ),
      okText: 'Save',
      onOk: submit,
    });
  };

  const create = () =>
    askName('New preset', '', (name) => createPluginPreset(pluginId, name));

  if (!Object.keys(presets).length) {
    return (
      <Flex justify="flex-end">
        <Tooltip title="Save these options under a name, then switch between them or run them side by side.">
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={create}>
            New preset
          </Button>
        </Tooltip>
      </Flex>
    );
  }

  return (
    <Space.Compact block>
      <Select
        aria-label="Preset"
        style={{ flex: 1, minWidth: 0 }}
        value={current ? selected : DEFAULT_PRESET}
        onChange={(presetId) => selectPluginPreset(pluginId, presetId)}
        options={[
          { value: DEFAULT_PRESET, label: 'Default' },
          ...Object.entries(presets).map(([value, { name }]) => ({
            value,
            label: name,
          })),
        ]}
      />
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{
          items: [
            {
              key: 'new',
              icon: <PlusOutlined />,
              label: 'New preset',
              onClick: create,
            },
            ...(current
              ? [
                  {
                    key: 'rename',
                    icon: <EditOutlined />,
                    label: 'Rename',
                    onClick: () =>
                      askName('Rename preset', current.name, (name) =>
                        renamePluginPreset(pluginId, selected, name),
                      ),
                  },
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: 'Delete',
                    danger: true,
                    onClick: () =>
                      modal.confirm({
                        title: `Delete "${current.name}"?`,
                        content:
                          'Schedules, chains and triggers using this preset will use Default.',
                        okText: 'Delete',
                        okButtonProps: { danger: true },
                        onOk: () => deletePluginPreset(pluginId, selected),
                      }),
                  },
                ]
              : []),
          ],
        }}
      >
        <Button icon={<EllipsisOutlined />} aria-label="Preset actions" />
      </Dropdown>
    </Space.Compact>
  );
};

export default PresetBar;
