import { useEffect, useState } from 'react';
import { Button, Empty, Flex, Input, Select, Typography, theme } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { SHARE_KIND_LABELS, type ShareKind } from '../../../common/share';
import { refreshShares, useShares } from '../../redux/shares';
import ShareStatusTag from './ShareStatusTag';
import { openShareModal } from './useShareTarget';

const PAGE_SIZE = 5;

/** Every share this installation published, also for items deleted since. */
const OwnedShareList: React.FC = () => {
  const { token } = theme.useToken();
  const owned = useShares((state) => state.owned);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ShareKind | 'all'>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(refreshShares, []);

  const shares = Object.values(owned).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!shares.length) return null;

  const kinds = [...new Set(shares.map((share) => share.kind))];
  const needle = query.trim().toLowerCase();
  const matching = shares.filter(
    (share) =>
      (kind === 'all' || share.kind === kind) &&
      share.title.toLowerCase().includes(needle),
  );
  const visible = matching.slice(0, limit);

  return (
    <Flex vertical gap={token.marginSM}>
      <Flex align="center" justify="space-between" gap={token.marginSM} wrap="wrap">
        <Typography.Text strong>
          Your shares{' '}
          <Typography.Text type="secondary">({shares.length})</Typography.Text>
        </Typography.Text>
        {shares.length > PAGE_SIZE && (
          <Flex gap={token.marginXS} wrap="wrap" style={{ flex: '1 1 240px', justifyContent: 'flex-end' }}>
            <Input
              allowClear
              size="small"
              prefix={<SearchOutlined />}
              placeholder="Search shares"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: '1 1 140px', maxWidth: 220 }}
            />
            {kinds.length > 1 && (
              <Select
                size="small"
                value={kind}
                onChange={setKind}
                style={{ minWidth: 120 }}
                options={[
                  { value: 'all', label: 'All types' },
                  ...kinds.map((value) => ({ value, label: SHARE_KIND_LABELS[value] })),
                ]}
              />
            )}
          </Flex>
        )}
      </Flex>

      {matching.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No shares match." />
      ) : (
        <Flex
          vertical
          style={{
            border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            overflow: 'hidden',
          }}
        >
          {visible.map((share, index) => (
            <Flex
              key={share.id}
              align="center"
              justify="space-between"
              gap={token.marginSM}
              style={{
                padding: `${token.paddingSM}px ${token.padding}px`,
                borderTop: index
                  ? `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`
                  : undefined,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <Typography.Text strong ellipsis={{ tooltip: share.title }} style={{ display: 'block' }}>
                  {share.title}
                </Typography.Text>
                <Flex align="center" gap={token.marginXXS} wrap="wrap">
                  <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {SHARE_KIND_LABELS[share.kind]} · {new Date(share.updatedAt).toLocaleDateString()}
                  </Typography.Text>
                  <ShareStatusTag share={share} />
                </Flex>
              </div>
              <Button
                size="small"
                onClick={() =>
                  openShareModal({
                    kind: share.kind,
                    ref: share.ref,
                    profileKey: share.profileKey,
                    title: share.title,
                  })
                }
              >
                Manage
              </Button>
            </Flex>
          ))}
          {matching.length > limit && (
            <Button
              type="text"
              block
              onClick={() => setLimit(limit + PAGE_SIZE * 2)}
              style={{ borderRadius: 0 }}
            >
              Show more ({matching.length - limit})
            </Button>
          )}
        </Flex>
      )}
    </Flex>
  );
};

export default OwnedShareList;
