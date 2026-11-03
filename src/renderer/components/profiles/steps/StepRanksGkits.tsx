import {
  Button,
  ColorPicker,
  Empty,
  Input,
  InputNumber,
  Space,
  Tabs,
  Tag,
  Typography,
  theme,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { JNdataServer } from '../../../../main/src/types';
import { gamemodeKey } from '../../../../common/profiles';
import { withAlpha } from '../../intro/introUtils';
import SectionHeader from '../SectionHeader';

const { Text } = Typography;

interface Props {
  /** Display labels for gamemodes — e.g. "FactionsImmortal". */
  gamemodes: string[];
  value: JNdataServer;
  onChange: (next: JNdataServer) => void;
}

const StepRanksGkits = ({ gamemodes, value, onChange }: Props) => {
  const { token } = theme.useToken();
  const [active, setActive] = useState<string>(gamemodes[0] ?? '');

  if (gamemodes.length === 0) {
    return (
      <div>
        <SectionHeader title="Ranks & kits" />
        <Empty
          description="Add gamemodes first"
          style={{ marginTop: token.marginXL }}
        />
      </div>
    );
  }

  const patchGamemode = (
    label: string,
    patch: Partial<{
      ranks: Record<string, { price: number; color: string }>;
      gkits: Record<string, number>;
    }>,
  ) => {
    const key = gamemodeKey(label);
    const existing = value[key] ?? { ranks: {}, gkits: {} };
    onChange({
      ...value,
      [key]: { ...existing, ...patch },
    });
  };

  const renderGamemode = (label: string) => {
    const key = gamemodeKey(label);
    const data = value[key] ?? { ranks: {}, gkits: {} };
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: token.marginLG,
        }}
      >
        <RanksEditor
          ranks={data.ranks ?? {}}
          onChange={(ranks) => patchGamemode(label, { ranks })}
        />
        <GkitsEditor
          gkits={data.gkits ?? {}}
          onChange={(gkits) => patchGamemode(label, { gkits })}
        />
      </div>
    );
  };

  const items = gamemodes.map((label) => {
    const data = value[gamemodeKey(label)] ?? { ranks: {}, gkits: {} };
    return {
      key: label,
      label: (
        <Space size={token.marginXS}>
          <span>{label}</span>
          <Tag style={{ margin: 0, fontSize: 10 }}>
            {Object.keys(data.ranks ?? {}).length} ranks
          </Tag>
          <Tag style={{ margin: 0, fontSize: 10 }}>
            {Object.keys(data.gkits ?? {}).length} gkits
          </Tag>
        </Space>
      ),
      children: renderGamemode(label),
    };
  });

  return (
    <div>
      <SectionHeader title="Ranks & kits">
        Ranks let bots use the best one an account owns. Kit prices are in €.
      </SectionHeader>

      <Tabs
        activeKey={active}
        onChange={setActive}
        items={items.map((item) => ({
          key: item.key,
          label: item.label,
          children: (
            <div
              style={{
                background: withAlpha(token.colorBgElevated, 0.3),
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadius,
                padding: token.padding,
                marginTop: token.marginXS,
              }}
            >
              {item.children}
            </div>
          ),
        }))}
        tabBarStyle={{ marginBottom: 0 }}
      />
    </div>
  );
};

const RanksEditor = ({
  ranks,
  onChange,
}: {
  ranks: Record<string, { price: number; color: string }>;
  onChange: (next: Record<string, { price: number; color: string }>) => void;
}) => {
  const { token } = theme.useToken();
  const [draftName, setDraftName] = useState('');

  const addRank = () => {
    const name = draftName.trim().toLowerCase();
    if (!name || ranks[name]) return;
    onChange({ ...ranks, [name]: { price: 10, color: '#FFFF55' } });
    setDraftName('');
  };

  const updateRank = (
    name: string,
    patch: Partial<{ price: number; color: string }>,
  ) => {
    onChange({ ...ranks, [name]: { ...ranks[name], ...patch } });
  };

  const removeRank = (name: string) => {
    const next = { ...ranks };
    delete next[name];
    onChange(next);
  };

  const entries = Object.entries(ranks);

  return (
    <div>
      <Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
        Ranks (cheapest → most expensive)
      </Text>
      <Space.Compact style={{ width: '100%', marginBottom: token.marginSM }}>
        <Input
          placeholder="e.g. skydonor"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onPressEnter={addRank}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={addRank}>
          Add
        </Button>
      </Space.Compact>

      {entries.length === 0 && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          No ranks yet.
        </Text>
      )}

      <Space orientation="vertical" size={token.marginXS} style={{ width: '100%' }}>
        {entries.map(([name, data]) => (
          <div
            key={name}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 110px 110px 32px',
              gap: token.marginXS,
              alignItems: 'center',
            }}
          >
            <Text ellipsis>{name}</Text>
            <InputNumber
              min={0}
              value={data.price}
              onChange={(price) => updateRank(name, { price: Number(price ?? 0) })}
              size="small"
              prefix="€"
              style={{ width: '100%' }}
            />
            <ColorPicker
              value={data.color}
              size="small"
              showText
              onChange={(_, hex) => updateRank(name, { color: hex })}
            />
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => removeRank(name)}
            />
          </div>
        ))}
      </Space>
    </div>
  );
};

const GkitsEditor = ({
  gkits,
  onChange,
}: {
  gkits: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) => {
  const { token } = theme.useToken();
  const [draftName, setDraftName] = useState('');

  const addKit = () => {
    const name = draftName.trim().toLowerCase();
    if (!name || gkits[name] !== undefined) return;
    onChange({ ...gkits, [name]: 60 });
    setDraftName('');
  };

  const updateKit = (name: string, price: number) => {
    onChange({ ...gkits, [name]: price });
  };

  const removeKit = (name: string) => {
    const next = { ...gkits };
    delete next[name];
    onChange(next);
  };

  const entries = Object.entries(gkits);

  return (
    <div>
      <Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
        Gkits (price)
      </Text>
      <Space.Compact style={{ width: '100%', marginBottom: token.marginSM }}>
        <Input
          placeholder="e.g. keys"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onPressEnter={addKit}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={addKit}>
          Add
        </Button>
      </Space.Compact>

      {entries.length === 0 && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          No gkits yet.
        </Text>
      )}

      <Space orientation="vertical" size={token.marginXS} style={{ width: '100%' }}>
        {entries.map(([name, price]) => (
          <div
            key={name}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 32px',
              gap: token.marginXS,
              alignItems: 'center',
            }}
          >
            <Text ellipsis>{name}</Text>
            <InputNumber
              min={0}
              value={price}
              onChange={(v) => updateKit(name, Number(v ?? 0))}
              size="small"
              prefix="€"
              style={{ width: '100%' }}
            />
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => removeKit(name)}
            />
          </div>
        ))}
      </Space>
    </div>
  );
};

export default StepRanksGkits;
