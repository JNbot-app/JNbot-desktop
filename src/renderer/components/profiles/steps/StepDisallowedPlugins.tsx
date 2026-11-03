import { FC, useState } from 'react';
import { Alert, Button, Empty, Input, Space, Typography, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ProfileScript } from '../../../../common/profileScripts';
import AddScriptModal from '../scripts/AddScriptModal';
import ProfileScriptRow from '../scripts/ProfileScriptRow';
import useAppApi from '../../../hooks/useAppApi';

const { Title, Text } = Typography;

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  embedded?: boolean;
}

const StepDisallowedPlugins: FC<Props> = ({ value, onChange, embedded }) => {
  const { token } = theme.useToken();
  const [adding, setAdding] = useState(false);
  const [pluginId, setPluginId] = useState('');
  const existing = new Set(value);
  const { message } = useAppApi();

  const add = (script: ProfileScript) =>
    onChange([...new Set([...value, script.pluginId])]);

  const addById = (rawPluginId: string) => {
    const id = rawPluginId.trim();
    if (!id) return;
    if (existing.has(id)) {
      message.info('This plugin is already blocked');
      return;
    }
    onChange([...value, id]);
    setPluginId('');
  };

  return (
    <div>
      <Title level={embedded ? 5 : 4} style={{ marginTop: 0 }}>
        Disallowed plugins
      </Title>
      <Text type="secondary">
        Block plugins from running whenever this profile is active. This also
        applies to cooldowns, script actions, and plugins started by another plugin.
      </Text>

      <div style={{ margin: '16px 0 12px', display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          Choose installed plugin
        </Button>
      </div>

      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
        Or block a plugin by ID when it is not installed locally.
      </Text>
      <Input.Search
        placeholder="Plugin ID"
        enterButton="Block ID"
        value={pluginId}
        onChange={(event) => setPluginId(event.target.value)}
        onSearch={addById}
        style={{ maxWidth: 440 }}
      />
    <br/>    <br/>
      {value.length ? (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          {value.map((pluginId, index) => (
            <ProfileScriptRow
              key={pluginId}
              script={{
                id: pluginId,
                pluginId,
                source: { kind: 'plugin', pluginId },
              }}
              index={index}
              total={value.length}
              onRemove={() => onChange(value.filter((id) => id !== pluginId))}
            />
          ))}
        </Space>
      ) : (
        <div
          style={{
            border: `1px dashed ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: 32,
          }}
        >
          <Empty description="No plugins are blocked for this profile." />
        </div>
      )}

      {!embedded && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          title="The block is enforced by the backend"
          description="Blocked plugins cannot be started even if a shortcut, automation, or another plugin requests them."
        />
      )}

      <AddScriptModal
        open={adding}
        onClose={() => setAdding(false)}
        existingPluginIds={existing}
        onAdd={add}
        title="Block a plugin"
        pluginOnly
      />
    </div>
  );
};

export default StepDisallowedPlugins;
