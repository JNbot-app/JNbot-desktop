import { Avatar, Button, Flex, Spin, Typography, theme } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import {
  useSettingsStore,
  selectCustomProfiles,
  selectInstalledServers,
  switchServer,
} from '../../redux/settings';
import { withAlpha } from '../intro/introUtils';
import { ProfileAvatar } from './ServerMarketplace';
import { useMarketProfiles, useServerInstall } from './useServerInstall';

const { Text } = Typography;

const Row: React.FC<{
  avatar: React.ReactNode;
  title: string;
  subtitle: string;
  action: React.ReactNode;
}> = ({ avatar, title, subtitle, action }) => {
  const { token } = theme.useToken();
  return (
    <Flex
      align="center"
      gap={token.marginSM}
      style={{
        padding: `${token.paddingSM}px ${token.padding}px`,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: withAlpha(token.colorBgContainer, 0.78),
      }}
    >
      {avatar}
      <Flex vertical style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <Text strong>{title}</Text>
        <Text type="secondary" ellipsis>
          {subtitle}
        </Text>
      </Flex>
      {action}
    </Flex>
  );
};

/**
 * Installed profiles plus the official servers on the marketplace, with one
 * button each: installs the server when needed, makes it the active one and
 * then calls `onPicked`.
 */
const ServerPickList = ({ onPicked }: { onPicked?: (id: string) => void }) => {
  const { token } = theme.useToken();
  const installedServers = useSettingsStore(selectInstalledServers);
  const customProfiles = useSettingsStore(selectCustomProfiles);
  const { profiles, loading } = useMarketProfiles();
  const { install, busyId } = useServerInstall();
  const installedShares = new Set(customProfiles.map((profile) => profile.share?.id));
  const available = profiles.filter(
    (entry) => entry.publisher.official && entry.canInstall && !installedShares.has(entry.id),
  );

  const use = (id: string) => {
    switchServer(id);
    onPicked?.(id);
  };
  return (
    <Flex vertical gap={token.marginSM} style={{ maxHeight: 360, overflowY: 'auto' }}>
      {installedServers.map((meta) => (
        <Row
          key={meta.id}
          avatar={
            <Avatar
              src={meta.icon || undefined}
              icon={meta.icon ? undefined : <GlobalOutlined />}
              shape="square"
              size={40}
              style={{
                flexShrink: 0,
                background: withAlpha(meta.color, 0.16),
                border: `1px solid ${withAlpha(meta.color, 0.4)}`,
              }}
            />
          }
          title={meta.name}
          subtitle={meta.gamemodes.length ? meta.gamemodes.slice(0, 6).join(', ') : meta.defaultIp || meta.name}
          action={<Button onClick={() => use(meta.id)}>Use</Button>}
        />
      ))}
      {available.map((entry) => (
        <Row
          key={entry.id}
          avatar={<ProfileAvatar entry={entry} size={40} />}
          title={entry.listing.title}
          subtitle={entry.listing.description || entry.listing.items.map((item) => item.name).join(', ')}
          action={
            <Button type="primary" loading={busyId === entry.id} onClick={() => install(entry, use)}>
              Add
            </Button>
          }
        />
      ))}
      {loading && <Spin style={{ alignSelf: 'center' }} />}
    </Flex>
  );
};

export default ServerPickList;
