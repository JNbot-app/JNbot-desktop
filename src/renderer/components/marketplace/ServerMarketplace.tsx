import { useState } from 'react';
import { Avatar, Button, Empty, Flex, Input, Modal, Space, Spin, Tag, Typography, theme } from 'antd';
import {
  AppstoreAddOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EyeOutlined,
  GlobalOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { MarketEntry } from '../../../common/share';
import { getServerMeta } from '../../../common/serverInfo';
import {
  useSettingsStore,
  selectAppSettings,
  selectCustomProfiles,
  selectInstalledServerIds,
  selectJNdata,
} from '../../redux/settings';
import { withAlpha } from '../intro/introUtils';
import { useOpenShareLink } from '../share/useShareTarget';
import { useMarketProfiles, useServerInstall } from './useServerInstall';

const { Title, Text } = Typography;

interface ServerMarketplaceProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful install with the new profile key. */
  onInstall?: (id: string) => void;
  /** Called when a server is removed, with the profile that is active now. */
  onUninstall?: (id: string, fallback: string | null) => void;
}

/** Banner (or colour) of a profile share as a square avatar. */
export const ProfileAvatar: React.FC<{ entry: MarketEntry; size?: number }> = ({ entry, size = 44 }) => {
  const { token } = theme.useToken();
  const color = entry.listing.color ?? token.colorPrimary;
  return (
    <Avatar
      src={entry.bannerUrl}
      shape="square"
      size={size}
      icon={!entry.bannerUrl ? <GlobalOutlined /> : undefined}
      style={{
        background: withAlpha(color, 0.2),
        color,
        border: `1px solid ${withAlpha(color, 0.4)}`,
        flexShrink: 0,
      }}
    />
  );
};

const gamemodesOf = (entry: MarketEntry) =>
  entry.listing.details.flatMap((section) => section.rows).find((row) => row.label === 'Gamemodes')?.value;

/** Official and community server profiles from the marketplace. */
const ServerMarketplace = ({ open, onClose, onInstall, onUninstall }: ServerMarketplaceProps) => {
  const { token } = theme.useToken();
  const appSettings = useSettingsStore(selectAppSettings);
  const customProfiles = useSettingsStore(selectCustomProfiles);
  const jndata = useSettingsStore(selectJNdata);
  const visibleServerIds = useSettingsStore(selectInstalledServerIds);
  const { profiles, loading, error } = useMarketProfiles();
  const { install, uninstall, busyId } = useServerInstall();
  const openShare = useOpenShareLink();
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const results = profiles.filter((entry) =>
    [entry.listing.title, entry.listing.description, entry.publisher.name, gamemodesOf(entry) ?? ''].some((text) =>
      text.toLowerCase().includes(query),
    ),
  );

  const view = (entry: MarketEntry) => {
    onClose();
    openShare(entry.id);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space size="small">
          <AppstoreAddOutlined style={{ color: token.colorPrimary }} />
          <span>Server marketplace</span>
        </Space>
      }
      width={720}
      centered
      footer={null}
      destroyOnHidden
      styles={{ body: { paddingTop: token.paddingSM } }}
    >
      <Input
        prefix={<SearchOutlined />}
        placeholder="Search servers, gamemodes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        size="large"
        style={{ marginTop: token.marginSM, marginBottom: token.margin }}
      />

      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {loading ? (
          <Flex justify="center" style={{ padding: token.paddingLG }}>
            <Spin />
          </Flex>
        ) : results.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              error ?? (query ? `No servers match "${search.trim()}"` : 'No servers available yet')
            }
          />
        ) : (
          <Space orientation="vertical" size={token.marginSM} style={{ width: '100%' }}>
            {results.map((entry) => {
              const profile = customProfiles.find((item) => item.share?.id === entry.id);
              const isActive = !!profile && appSettings.server === profile.id;
              const onlyVisible = isActive && visibleServerIds.length === 1;
              const color = entry.listing.color ?? token.colorPrimary;

              return (
                <div
                  key={entry.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                    gap: token.marginSM,
                    alignItems: 'center',
                    padding: `${token.paddingSM}px ${token.padding}px`,
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${profile ? withAlpha(color, 0.4) : token.colorBorderSecondary}`,
                    background: profile ? withAlpha(color, 0.06) : withAlpha(token.colorBgElevated, 0.4),
                  }}
                >
                  <ProfileAvatar entry={entry} />
                  <div style={{ minWidth: 0 }}>
                    <Space size={token.marginXS} wrap>
                      <Text strong>{entry.listing.title}</Text>
                      {entry.publisher.official ? (
                        <Tag color="processing" icon={<SafetyCertificateOutlined />}>
                          Official
                        </Tag>
                      ) : (
                        <Tag>Community · {entry.publisher.name}</Tag>
                      )}
                    </Space>
                    <div>
                      <Text type="secondary" ellipsis style={{ fontSize: token.fontSizeSM }}>
                        {gamemodesOf(entry) ?? entry.listing.description}
                      </Text>
                    </div>
                  </div>
                  <div>
                    {profile ? (
                      <Button
                        icon={<DeleteOutlined />}
                        danger
                        disabled={onlyVisible}
                        onClick={() =>
                          uninstall(getServerMeta(jndata, profile.id), (result) =>
                            onUninstall?.(profile.id, result.fallbackServer),
                          )
                        }
                      >
                        Remove
                      </Button>
                    ) : !entry.canInstall ? (
                      <Text type="warning">Needs JNbot {entry.listing.minAppVersion}</Text>
                    ) : entry.publisher.official ? (
                      <Button
                        type="primary"
                        icon={<CloudDownloadOutlined />}
                        loading={busyId === entry.id}
                        onClick={() => install(entry, onInstall)}
                      >
                        Add
                      </Button>
                    ) : (
                      <Button icon={<EyeOutlined />} onClick={() => view(entry)}>
                        View
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </Space>
        )}
      </div>

      <div
        style={{
          marginTop: token.margin,
          padding: token.paddingSM,
          borderRadius: token.borderRadius,
          background: withAlpha(token.colorPrimary, 0.06),
          border: `1px dashed ${withAlpha(token.colorPrimary, 0.3)}`,
        }}
      >
        <Title level={5} style={{ margin: 0 }}>
          Don't see your server?
        </Title>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          Build a custom profile for any Minecraft server: full control over gamemodes, ranks, and scripts. Share it on
          the marketplace so others can use it too.
        </Text>
      </div>
    </Modal>
  );
};

export default ServerMarketplace;
