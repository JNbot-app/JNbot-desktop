import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Empty,
  Flex,
  Input,
  Result,
  Select,
  Skeleton,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  SHARE_KINDS,
  SHARE_KIND_INFO,
  isShareKind,
  shareInstallKey,
  shareInstallState,
  shareMatchesServer,
  type MarketEntry,
  type ShareKind,
} from '../../common/share';
import MarketFeatured from '../components/marketplace/MarketFeatured';
import MarketRow from '../components/marketplace/MarketRow';
import MarketSection, {
  RowGrid,
} from '../components/marketplace/MarketSection';
import MarketSidebar, {
  type MarketFilters,
  type MarketSort,
} from '../components/marketplace/MarketSidebar';
import { useQuickInstall } from '../components/share/useInstallShare';
import {
  loadReviewQueue,
  useReviewQueue,
} from '../components/share/useReviewQueue';
import { useOpenShareLink } from '../components/share/useShareTarget';
import {
  selectActiveServerId,
  selectJNdata,
  useSettingsStore,
} from '../redux/settings';
import { initShares, loadMarket, useMarket, useShares } from '../redux/shares';

const matches = (entry: MarketEntry, query: string) => {
  if (!query) return true;
  const { listing } = entry;
  return [
    listing.title,
    listing.description,
    entry.publisher.name,
    ...listing.items.map((item) => item.name),
  ].some((text) => text.toLowerCase().includes(query));
};

const SHELF_SIZE = 6;
const FEATURED_SIZE = 3;

/** Public plugins, bundles, profiles, chains and triggers, reviewed by the JNbot team. */
const Marketplace = () => {
  const { token } = theme.useToken();
  const [params, setParams] = useSearchParams();
  const initialKind = params.get('kind');
  const [filters, setFilters] = useState<MarketFilters>({
    type: isShareKind(initialKind) ? initialKind : 'all',
    search: '',
    scope: 'current',
    sort: 'newest',
  });
  const [reviewing, setReviewing] = useState(false);
  const { entries, loading, error } = useMarket();
  const reviewer = useShares((state) => state.reviewer);
  const installed = useShares((state) => state.installed);
  const appVersion = useShares((state) => state.appVersion);
  const queue = useReviewQueue();
  const serverId = useSettingsStore(selectActiveServerId);
  const profileName = useSettingsStore((state) =>
    serverId ? selectJNdata(state)?.data?.[serverId]?.name : undefined,
  );
  const openShare = useOpenShareLink();
  const quickInstall = useQuickInstall();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    initShares();
    void loadMarket();
  }, []);
  useEffect(() => {
    if (reviewer) void loadReviewQueue();
  }, [reviewer]);

  const change = (next: Partial<MarketFilters>) => {
    setFilters({ ...filters, ...next });
    if (next.type)
      setParams(next.type === 'all' ? {} : { kind: next.type }, {
        replace: true,
      });
  };

  const query = filters.search.trim().toLowerCase();
  const sort = (list: MarketEntry[]) =>
    list.sort((a, b) =>
      filters.sort === 'name'
        ? a.listing.title.localeCompare(b.listing.title)
        : b.updatedAt - a.updatedAt,
    );
  const scoped = (entries ?? []).filter(
    (entry) =>
      filters.scope === 'all' ||
      entry.kind === 'profile' ||
      shareMatchesServer(entry.listing.servers, serverId),
  );
  const byKind = Object.fromEntries(
    SHARE_KINDS.map((kind) => [
      kind,
      sort(
        scoped.filter((entry) => entry.kind === kind && matches(entry, query)),
      ),
    ]),
  ) as Record<ShareKind, MarketEntry[]>;
  const counts = Object.fromEntries(
    SHARE_KINDS.map((kind) => [kind, byKind[kind].length]),
  ) as Record<ShareKind, number>;

  const open = (entry: MarketEntry, review = false) =>
    review
      ? openShare(entry.id, {
          revision: entry.revision,
          reports: entry.reportReasons ?? [],
        })
      : openShare(entry.id, { entry });
  // Anything that needs a closer look (unknown publisher, conflicts) opens its panel instead.
  const get = async (entry: MarketEntry) => {
    setBusyId(entry.id);
    try {
      if (!(await quickInstall(entry))) open(entry);
    } finally {
      setBusyId(null);
    }
  };
  const rows = (list: MarketEntry[], review = false) => (
    <RowGrid>
      {list.map((entry) => (
        <MarketRow
          key={entry.id}
          entry={entry}
          busy={busyId === entry.id}
          installState={shareInstallState(
            installed[shareInstallKey(entry.id, entry.kind, serverId)],
            entry.revision,
            entry.listing.minAppVersion,
            appVersion,
            entry.publisher.own,
          )}
          onOpen={() => open(entry, review)}
          onGet={() => void get(entry)}
        />
      ))}
    </RowGrid>
  );
  const featured =
    filters.type === 'all' && !query
      ? [...byKind.plugin, ...byKind.bundle]
          .filter((entry) => entry.bannerUrl)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, FEATURED_SIZE)
      : [];

  const emptyText = query
    ? 'Nothing matches your search.'
    : filters.scope === 'current'
      ? `Nothing made for ${profileName ?? 'this profile'} yet.`
      : 'Nothing here yet. Share yours from its menu and pick Marketplace.';
  const empty = (
    <Empty style={{ padding: token.paddingLG }} description={emptyText}>
      {!query && filters.scope === 'current' && (
        <Button onClick={() => change({ scope: 'all' })}>
          Show items for every profile
        </Button>
      )}
    </Empty>
  );

  let body: React.ReactNode;
  if (reviewing) {
    body =
      queue.loading && !queue.entries ? (
        <Skeleton active />
      ) : queue.entries?.length ? (
        rows(queue.entries, true)
      ) : (
        <Empty
          style={{ padding: token.paddingLG }}
          description="Nothing waiting for review."
        />
      );
  } else if (loading && !entries) {
    body = (
      <RowGrid>
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton.Node
            key={index}
            active
            style={{ width: '100%', height: 78 }}
          />
        ))}
      </RowGrid>
    );
  } else if (error && !entries) {
    body = (
      <Result
        status="warning"
        title="Could not load the marketplace"
        subTitle={error}
        extra={<Button onClick={() => loadMarket(true)}>Try again</Button>}
      />
    );
  } else if (filters.type !== 'all') {
    const list = byKind[filters.type];
    body = list.length ? rows(list) : empty;
  } else {
    const kinds = SHARE_KINDS.filter((kind) => byKind[kind].length);
    body = kinds.length ? (
      <>
        {!!featured.length && (
          <MarketFeatured entries={featured} onOpen={(entry) => open(entry)} />
        )}
        {kinds.map((kind) => {
          // While searching every match shows; otherwise a short list per kind.
          const shown = query ? byKind[kind] : byKind[kind].slice(0, SHELF_SIZE);
          return (
            <MarketSection
              key={kind}
              kind={kind}
              total={byKind[kind].length}
              onSeeAll={
                byKind[kind].length > shown.length
                  ? () => change({ type: kind })
                  : undefined
              }
            >
              {rows(shown)}
            </MarketSection>
          );
        })}
      </>
    ) : (
      empty
    );
  }

  const title = reviewing
    ? 'Review queue'
    : filters.type === 'all'
      ? 'Discover'
      : SHARE_KIND_INFO[filters.type].plural;
  const subtitle = reviewing
    ? 'New submissions and reported items. Open one to approve or reject it.'
    : filters.type === 'all'
      ? 'Plugins, server profiles and automations from the community, checked by the JNbot team.'
      : SHARE_KIND_INFO[filters.type].blurb;

  return (
    <Flex gap={token.marginXL} align="flex-start">
      <MarketSidebar
        filters={filters}
        counts={counts}
        total={SHARE_KINDS.reduce((sum, kind) => sum + counts[kind], 0)}
        onChange={change}
        profileName={profileName}
        review={
          reviewer
            ? {
                active: reviewing,
                pending: queue.entries?.length,
                onToggle: () => setReviewing(!reviewing),
              }
            : undefined
        }
      />
      <Flex vertical gap={token.marginLG} style={{ flex: 1, minWidth: 0 }}>
        <Flex align="center" justify="space-between" gap={token.marginSM} wrap>
          <Flex vertical>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {title}
            </Typography.Title>
            <Typography.Text type="secondary">{subtitle}</Typography.Text>
          </Flex>
          <Flex gap={token.marginXS}>
            {!reviewing && (
              <>
                <Input
                  prefix={<SearchOutlined />}
                  allowClear
                  value={filters.search}
                  onChange={(event) => change({ search: event.target.value })}
                  placeholder="Search name, publisher or plugin"
                  style={{ width: 280 }}
                />
                <Select<MarketSort>
                  value={filters.sort}
                  onChange={(sort) => change({ sort })}
                  options={[
                    { value: 'newest', label: 'Newest' },
                    { value: 'name', label: 'A–Z' },
                  ]}
                />
              </>
            )}
            <Tooltip title="Refresh">
              <Button
                icon={<ReloadOutlined />}
                loading={reviewing ? queue.loading : loading}
                onClick={() =>
                  reviewing ? loadReviewQueue() : loadMarket(true)
                }
              />
            </Tooltip>
          </Flex>
        </Flex>
        {body}
      </Flex>
    </Flex>
  );
};

export default Marketplace;
