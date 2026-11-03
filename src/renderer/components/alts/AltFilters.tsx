import React, { useMemo } from 'react';
import {
  Badge,
  Button,
  Divider,
  Popover,
  Segmented,
  Select,
  Space,
  Typography,
  theme,
} from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import type { AltWithData } from '../../../../src/main/src/types.d.ts';

/**
 * Advanced, structured filtering for the alt grid. Lets the user narrow alts
 * down by gamemode, the gkits they own, and/or their rank. All constraints are
 * combined with AND; only gkits/ranks actually restrict the result set, while
 * `gamemode` scopes which gamemode's gkits/ranks are inspected.
 */
export interface AdvancedFilters {
  /** When set, gkit/rank matching only looks at this gamemode. */
  gamemode: string | null;
  /** Required gkits (matched per `gkitMatch`). */
  gkits: string[];
  /** Alt passes if it has any of these ranks. */
  ranks: string[];
  /** Whether an alt must own all selected gkits or just any of them. */
  gkitMatch: 'any' | 'all';
}

export const EMPTY_FILTERS: AdvancedFilters = {
  gamemode: null,
  gkits: [],
  ranks: [],
  gkitMatch: 'any',
};

/** Only gkit/rank selections actually filter; a lone gamemode is just scoping. */
export const isFiltersActive = (f: AdvancedFilters): boolean =>
  f.gkits.length > 0 || f.ranks.length > 0;

/** Number of active constraint dimensions, used for the badge count. */
export const countActiveFilters = (f: AdvancedFilters): number =>
  (f.gkits.length > 0 ? 1 : 0) + (f.ranks.length > 0 ? 1 : 0);

/**
 * Build a predicate for the current filters, or `null` when nothing is active
 * so callers can skip filtering entirely. Selected sets are computed once and
 * captured in the closure to keep per-row matching cheap.
 */
export const buildAdvancedFilterPredicate = (
  f: AdvancedFilters,
): ((alt: AltWithData) => boolean) | null => {
  if (!isFiltersActive(f)) return null;
  const rankSet = new Set(f.ranks);

  return (alt: AltWithData) => {
    const data = alt.data;

    if (f.gkits.length > 0) {
      const altGkits = f.gamemode
        ? data?.gkits?.[f.gamemode] ?? []
        : Object.values(data?.gkits ?? {}).flat();
      const altSet = new Set(altGkits);
      const ok =
        f.gkitMatch === 'all'
          ? f.gkits.every((g) => altSet.has(g))
          : f.gkits.some((g) => altSet.has(g));
      if (!ok) return false;
    }

    if (f.ranks.length > 0) {
      const altRanks = f.gamemode
        ? [data?.ranks?.[f.gamemode]]
        : Object.values(data?.ranks ?? {});
      const ok = altRanks.some((r) => r && rankSet.has(r));
      if (!ok) return false;
    }

    return true;
  };
};

interface AltFiltersProps {
  alts: AltWithData[];
  value: AdvancedFilters;
  onChange: (value: AdvancedFilters) => void;
}

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography.Text
    strong
    style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
  >
    {children}
  </Typography.Text>
);

const AltFilters: React.FC<AltFiltersProps> = ({ alts, value, onChange }) => {
  const {
    token: { colorTextSecondary },
  } = theme.useToken();

  // Derive every gamemode and its available gkits/ranks from the alt set once.
  const { gamemodes, gkitsByGamemode, ranksByGamemode } = useMemo(() => {
    const gms = new Set<string>();
    const gkitsByGm = new Map<string, Set<string>>();
    const ranksByGm = new Map<string, Set<string>>();

    for (const alt of alts) {
      const data = alt.data;
      if (!data) continue;

      for (const [gm, kits] of Object.entries(data.gkits ?? {})) {
        if (kits.length === 0) continue;
        gms.add(gm);
        let s = gkitsByGm.get(gm);
        if (!s) gkitsByGm.set(gm, (s = new Set()));
        for (const k of kits) s.add(k);
      }

      for (const [gm, rank] of Object.entries(data.ranks ?? {})) {
        if (!rank) continue;
        gms.add(gm);
        let s = ranksByGm.get(gm);
        if (!s) ranksByGm.set(gm, (s = new Set()));
        s.add(rank);
      }
    }

    return {
      gamemodes: [...gms].sort(),
      gkitsByGamemode: gkitsByGm,
      ranksByGamemode: ranksByGm,
    };
  }, [alts]);

  // Options are scoped to the chosen gamemode, or the union across all of them.
  const collectScoped = (source: Map<string, Set<string>>) => {
    const set = new Set<string>();
    if (value.gamemode) {
      source.get(value.gamemode)?.forEach((v) => set.add(v));
    } else {
      source.forEach((s) => s.forEach((v) => set.add(v)));
    }
    return [...set].sort().map((v) => ({ label: v, value: v }));
  };

  const gkitOptions = useMemo(
    () => collectScoped(gkitsByGamemode),
    [gkitsByGamemode, value.gamemode],
  );
  const rankOptions = useMemo(
    () => collectScoped(ranksByGamemode),
    [ranksByGamemode, value.gamemode],
  );

  const activeCount = countActiveFilters(value);

  const content = (
    <div style={{ width: 320 }}>
      <Space orientation="vertical" size={14} style={{ width: '100%' }}>
        <div>
          <FieldLabel>Gamemode</FieldLabel>
          <Select
            value={value.gamemode ?? undefined}
            onChange={(gamemode) => onChange({ ...value, gamemode: gamemode ?? null })}
            allowClear
            placeholder="All gamemodes"
            style={{ width: '100%' }}
            options={gamemodes.map((g) => ({ label: g, value: g }))}
            notFoundContent="No gamemodes found"
          />
        </div>

        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <FieldLabel>Gkits</FieldLabel>
            {value.gkits.length > 1 && (
              <Segmented
                size="small"
                value={value.gkitMatch}
                onChange={(gkitMatch) =>
                  onChange({ ...value, gkitMatch: gkitMatch as 'any' | 'all' })
                }
                options={[
                  { label: 'Any', value: 'any' },
                  { label: 'All', value: 'all' },
                ]}
              />
            )}
          </div>
          <Select
            mode="multiple"
            value={value.gkits}
            onChange={(gkits) => onChange({ ...value, gkits })}
            allowClear
            placeholder="Any gkit"
            style={{ width: '100%' }}
            options={gkitOptions}
            maxTagCount="responsive"
            notFoundContent="No gkits found"
          />
        </div>

        <div>
          <FieldLabel>Ranks</FieldLabel>
          <Select
            mode="multiple"
            value={value.ranks}
            onChange={(ranks) => onChange({ ...value, ranks })}
            allowClear
            placeholder="Any rank"
            style={{ width: '100%' }}
            options={rankOptions}
            maxTagCount="responsive"
            notFoundContent="No ranks found"
          />
        </div>

        <Divider style={{ margin: 0 }} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography.Text style={{ fontSize: 12, color: colorTextSecondary }}>
            {activeCount === 0
              ? 'No active filters'
              : `${activeCount} active filter${activeCount > 1 ? 's' : ''}`}
          </Typography.Text>
          <Button
            type="link"
            size="small"
            disabled={!isFiltersActive(value) && !value.gamemode}
            onClick={() => onChange(EMPTY_FILTERS)}
          >
            Reset
          </Button>
        </div>
      </Space>
    </div>
  );

  return (
    <Popover
      content={content}
      title="Advanced filters"
      trigger="click"
      placement="bottomRight"
    >
      <Badge count={activeCount} size="small">
        <Button icon={<FilterOutlined />} type={activeCount > 0 ? 'primary' : 'default'}>
          Filters
        </Button>
      </Badge>
    </Popover>
  );
};

export default AltFilters;
