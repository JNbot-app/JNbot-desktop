import { Badge, Divider, Flex, Select, Typography, theme } from 'antd';
import { AppstoreAddOutlined, AuditOutlined } from '@ant-design/icons';
import {
  SHARE_KINDS,
  SHARE_KIND_INFO,
  type ShareKind,
} from '../../../common/share';
import { SHARE_KIND_ICONS } from './KindTile';

export type MarketType = ShareKind | 'all';
export type MarketScope = 'current' | 'all';
export type MarketSort = 'newest' | 'name';

export interface MarketFilters {
  type: MarketType;
  search: string;
  scope: MarketScope;
  sort: MarketSort;
}

const NavItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}> = ({ icon, label, count, active, onClick }) => {
  const { token } = theme.useToken();
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      style={{
        all: 'unset',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: token.marginXS,
        height: token.controlHeight,
        padding: `0 ${token.paddingSM}px`,
        cursor: 'pointer',
        borderRadius: token.borderRadius,
        color: active ? token.colorPrimary : token.colorText,
        background: active ? token.colorPrimaryBg : 'transparent',
        fontWeight: active ? token.fontWeightStrong : undefined,
      }}
    >
      <span style={{ width: 16, display: 'grid', placeItems: 'center' }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {!!count && (
        <Typography.Text
          type="secondary"
          style={{ fontSize: token.fontSizeSM, color: 'inherit', opacity: 0.7 }}
        >
          {count}
        </Typography.Text>
      )}
    </button>
  );
};

/** Kind navigation plus the profile filter; sticks to the top while the list scrolls. */
const MarketSidebar: React.FC<{
  filters: MarketFilters;
  counts: Record<ShareKind, number>;
  total: number;
  onChange: (change: Partial<MarketFilters>) => void;
  profileName?: string;
  /** Present for reviewers: opens the review queue. */
  review?: { active: boolean; pending?: number; onToggle: () => void };
}> = ({ filters, counts, total, onChange, profileName, review }) => {
  const { token } = theme.useToken();
  const browsing = !review?.active;
  return (
    <Flex
      vertical
      gap={token.marginXXS}
      style={{ width: 200, flexShrink: 0, position: 'sticky', top: 0 }}
    >
      <NavItem
        icon={<AppstoreAddOutlined />}
        label="Discover"
        count={total}
        active={browsing && filters.type === 'all'}
        onClick={() => {
          if (review?.active) review.onToggle();
          onChange({ type: 'all' });
        }}
      />
      {SHARE_KINDS.map((kind) => (
        <NavItem
          key={kind}
          icon={SHARE_KIND_ICONS[kind]}
          label={SHARE_KIND_INFO[kind].plural}
          count={counts[kind]}
          active={browsing && filters.type === kind}
          onClick={() => {
            if (review?.active) review.onToggle();
            onChange({ type: kind });
          }}
        />
      ))}
      {review && (
        <>
          <Divider style={{ margin: `${token.marginXS}px 0` }} />
          <Badge count={review.pending} size="small" offset={[-12, 16]}>
            <NavItem
              icon={<AuditOutlined />}
              label="Review queue"
              active={review.active}
              onClick={() => !review.active && review.onToggle()}
            />
          </Badge>
        </>
      )}
      {browsing && filters.type !== 'profile' && (
        <>
          <Divider style={{ margin: `${token.marginXS}px 0` }} />
          <Typography.Text
            type="secondary"
            style={{
              fontSize: token.fontSizeSM,
              padding: `0 ${token.paddingSM}px`,
            }}
          >
            Works on
          </Typography.Text>
          <Select<MarketScope>
            value={filters.scope}
            onChange={(scope) => onChange({ scope })}
            options={[
              { value: 'current', label: profileName ?? 'This profile' },
              { value: 'all', label: 'Every profile' },
            ]}
          />
        </>
      )}
    </Flex>
  );
};

export default MarketSidebar;
