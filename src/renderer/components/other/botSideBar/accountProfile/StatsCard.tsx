import { FC, useEffect, useState } from 'react';
import { Card, Col, Row, Tag, theme, Typography } from 'antd';
import { LineChartOutlined } from '@ant-design/icons';
import type {
  StatsBreakdownItem,
  StatsSectionData,
} from '../../../../../common/profileUiSchema';

const GamemodeTile: FC<{
  label: string;
  icon?: string;
  accent?: string;
  selected: boolean;
  onClick: () => void;
}> = ({ label, icon, accent, selected, onClick }) => {
  const { token } = theme.useToken();
  const ring = accent ?? token.colorPrimary;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        flex: '0 0 auto',
        width: 92,
        height: 80,
        padding: 10,
        borderRadius: 12,
        cursor: 'pointer',
        background: selected ? `${ring}1f` : token.colorBgElevated,
        border: `1px solid ${
          selected ? `${ring}88` : token.colorBorderSecondary
        }`,
        boxShadow: selected ? `0 0 0 2px ${ring}33` : 'none',
        color: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        transition: 'all 0.15s ease',
      }}
    >
      <span style={{ fontSize: 24, lineHeight: 1 }}>{icon ?? '🎮'}</span>
      <span
        style={{
          fontSize: 10,
          opacity: 0.75,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          width: '100%',
        }}
      >
        {label}
      </span>
    </button>
  );
};

const BreakdownItem: FC<{ item: StatsBreakdownItem }> = ({ item }) => (
  <Col xs={12} md={12}>
    <Typography.Text
      type="secondary"
      style={{
        fontSize: 11,
        letterSpacing: 0.5,
        textTransform: 'lowercase',
      }}
    >
      {item.label}
    </Typography.Text>
    <div
      style={{
        fontSize: 28,
        fontWeight: 700,
        lineHeight: 1.1,
        marginTop: 2,
      }}
    >
      {item.value}
    </div>
    <div
      style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}
    >
      {item.rank && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          rank {item.rank}
        </Typography.Text>
      )}
      {item.delta && (
        <Tag
          color={item.delta.trim().startsWith('-') ? 'red' : 'green'}
          style={{ margin: 0, fontSize: 11 }}
        >
          {item.delta}
        </Tag>
      )}
    </div>
  </Col>
);

const StatsCard: FC<{ data: StatsSectionData }> = ({ data }) => {
  const { token } = theme.useToken();
  const initial = data.selected ?? data.gamemodes[0]?.id ?? '';
  const [selected, setSelected] = useState(initial);

  useEffect(() => setSelected(initial), [initial]);

  const activeGamemode = data.gamemodes.find((g) => g.id === selected);
  const activeLabel = activeGamemode?.label ?? selected;
  // Per-gamemode breakdown overrides the top-level fallback. If neither is
  // set, the breakdown row is just empty for that tile.
  const activeBreakdown = activeGamemode?.breakdown ?? data.breakdown;

  return (
    <Card
      variant="borderless"
      style={{ background: token.colorBgContainer }}
      styles={{ body: { padding: token.paddingLG } }}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LineChartOutlined /> Stats
        </span>
      }
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {activeLabel}
        </Typography.Text>
      }
    >
      {!!data.gamemodes.length && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 8,
            marginBottom: 16,
          }}
        >
          {data.gamemodes.map((g) => (
            <GamemodeTile
              key={g.id}
              label={g.label}
              icon={g.icon}
              accent={g.accent}
              selected={g.id === selected}
              onClick={() => setSelected(g.id)}
            />
          ))}
        </div>
      )}

      <Row gutter={[24, 20]}>
        {activeBreakdown.map((b, i) => (
          <BreakdownItem key={`${selected}-${b.label}-${i}`} item={b} />
        ))}
      </Row>
    </Card>
  );
};

export default StatsCard;
