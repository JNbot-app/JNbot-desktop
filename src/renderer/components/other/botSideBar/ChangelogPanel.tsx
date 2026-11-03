import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Skeleton, Space, Tag, Timeline, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PAGE_SIZE = 10;

interface Release {
  id: number;
  tag_name: string;
  name?: string;
  body?: string;
  published_at?: string;
  prerelease?: boolean;
}

const fetchReleases = async (page: number): Promise<Release[]> => {
  const response = await fetch(
    `https://api.github.com/repos/usserwout/JNbot-updater/releases?page=${page}&per_page=${PAGE_SIZE}`,
  );
  if (!response.ok) throw new Error(`GitHub responded with ${response.status}`);
  return response.json();
};

const heading = ({ children }: { children?: React.ReactNode }) => (
  <Typography.Text strong style={{ display: 'block', marginTop: 8 }}>
    {children}
  </Typography.Text>
);

const markdownComponents = { h1: heading, h2: heading, h3: heading, h4: heading };

const ReleaseEntry = ({ release }: { release: Release }) => (
  <Space direction="vertical" size={4} style={{ width: '100%' }}>
    <Space size={8} wrap>
      <Typography.Title level={5} style={{ margin: 0 }}>
        {release.tag_name}
      </Typography.Title>
      {release.prerelease && <Tag color="orange">Pre-release</Tag>}
      {release.published_at && (
        <Typography.Text type="secondary">
          {new Date(release.published_at).toLocaleDateString()}
        </Typography.Text>
      )}
    </Space>
    {release.body ? (
      <Typography>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {release.body}
        </ReactMarkdown>
      </Typography>
    ) : (
      <Typography.Text type="secondary">No release notes.</Typography.Text>
    )}
  </Space>
);

/** Mounted only while its side panel tab is open, so releases are fetched on demand. */
const ChangelogPanel = () => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadMore = useCallback(async (page: number) => {
    setLoading(true);
    setFailed(false);
    try {
      const next = await fetchReleases(page);
      setReleases((prev) => (page === 1 ? next : [...prev, ...next]));
      setHasMore(next.length === PAGE_SIZE);
    } catch (err) {
      console.log('Failed to fetch releases', err);
      setFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMore(1);
  }, [loadMore]);

  if (!releases.length) {
    if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
    return (
      <Empty
        description={failed ? 'Could not load the changelog' : 'No releases yet'}
      >
        {failed && (
          <Button icon={<ReloadOutlined />} onClick={() => loadMore(1)}>
            Retry
          </Button>
        )}
      </Empty>
    );
  }

  return (
    <>
      <Timeline
        items={releases.map((release, i) => ({
          key: release.id,
          color: i === 0 ? 'green' : 'gray',
          children: <ReleaseEntry release={release} />,
        }))}
      />
      {hasMore && (
        <Button
          block
          loading={loading}
          onClick={() => loadMore(Math.ceil(releases.length / PAGE_SIZE) + 1)}
        >
          {failed ? 'Retry' : 'Load more'}
        </Button>
      )}
    </>
  );
};

export default ChangelogPanel;
