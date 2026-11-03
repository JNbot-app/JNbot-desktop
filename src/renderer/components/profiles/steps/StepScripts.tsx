import { FC, useState } from 'react';
import { Alert, Button, Divider, Empty, Space, Typography, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ProfileScript } from '../../../../common/profileScripts';
import { sortScripts } from '../../../../common/profileScripts';
import ProfileScriptRow from '../scripts/ProfileScriptRow';
import AddScriptModal from '../scripts/AddScriptModal';
import StepDisallowedPlugins from './StepDisallowedPlugins';
import SectionHeader from '../SectionHeader';

const { Text } = Typography;

interface Props {
  value: ProfileScript[];
  onChange: (next: ProfileScript[]) => void;
  disallowedPlugins: string[];
  onDisallowedPluginsChange: (next: string[]) => void;
}

const StepScripts: FC<Props> = ({
  value,
  onChange,
  disallowedPlugins,
  onDisallowedPluginsChange,
}) => {
  const { token } = theme.useToken();
  const [adding, setAdding] = useState(false);

  // Always render the list in stable order so reorder buttons make sense.
  const ordered = sortScripts(value);
  const existing = new Set(ordered.map((s) => s.pluginId));

  const replaceList = (next: ProfileScript[]) => {
    onChange(next.map((s, i) => ({ ...s, order: (i + 1) * 10 })));
  };

  const handleAdd = (script: ProfileScript) => {
    const max = ordered.reduce((m, s) => Math.max(m, s.order ?? 0), 0);
    replaceList([...ordered, { ...script, order: max + 10 }]);
  };

  const handleMove = (id: string, delta: -1 | 1) => {
    const idx = ordered.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= ordered.length) return;
    const next = ordered.slice();
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    replaceList(next);
  };

  const handleRemove = (id: string) => {
    replaceList(ordered.filter((s) => s.id !== id));
  };

  const handleToggleHidden = (id: string) => {
    replaceList(
      ordered.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)),
    );
  };

  return (
    <div>
      <SectionHeader title="Dashboard scripts">
        Shown on the dashboard for this server, top to bottom. Hidden scripts
        can still be run by other scripts.
      </SectionHeader>

      <div style={{ marginTop: 16, marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          Add script
        </Button>
      </div>

      {ordered.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: 32,
          }}
        >
          <Empty
            description={
              <Space orientation="vertical" size={4}>
                <Text>No scripts on this profile yet.</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Add at least one script to give the dashboard something to run.
                </Text>
              </Space>
            }
          />
        </div>
      ) : (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          {ordered.map((s, i) => (
            <ProfileScriptRow
              key={s.id}
              script={s}
              index={i}
              total={ordered.length}
              onMove={(d) => handleMove(s.id, d)}
              onRemove={() => handleRemove(s.id)}
              onToggleHidden={() => handleToggleHidden(s.id)}
            />
          ))}
        </Space>
      )}

      {ordered.length === 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          title="Scripts are optional"
          description="You can save a profile with no scripts and add them later from this same wizard."
        />
      )}

      <Divider />
      <StepDisallowedPlugins
        embedded
        value={disallowedPlugins}
        onChange={onDisallowedPluginsChange}
      />

      <AddScriptModal
        open={adding}
        onClose={() => setAdding(false)}
        existingPluginIds={existing}
        onAdd={handleAdd}
      />
    </div>
  );
};

export default StepScripts;
