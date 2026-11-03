import { useState } from 'react';
import {
  Dropdown,
  Button,
  MenuProps,
  Space,
  Avatar,
  Badge,
  theme,
  Flex,
  Typography,
} from 'antd';
import {
  AppstoreAddOutlined,
  CheckOutlined,
  GlobalOutlined,
  PlusOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { LuChevronsUpDown } from 'react-icons/lu';
import { useNavigate } from 'react-router-dom';
import {
  useSettingsStore,
  selectAppSettings,
  selectInstalledServers,
  switchServer,
} from '../redux/settings';
import { ServerMeta } from '../../common/serverInfo';
import ServerMarketplace from './marketplace/ServerMarketplace';
import useProfileRuntimeSummaries from '../hooks/useProfileRuntimeSummaries';

const renderServerAvatar = (
  meta: ServerMeta,
  size: number,
  shape: 'square' | 'circle' = 'square',
) => {
  if (meta.icon) {
    return (
      <Avatar
        src={meta.icon}
        shape={shape}
        size={size}
        style={{ backgroundColor: meta.color, flexShrink: 0 }}
      />
    );
  }
  return (
    <Avatar
      shape={shape}
      size={size}
      style={{ backgroundColor: meta.color, flexShrink: 0 }}
      icon={<GlobalOutlined />}
    />
  );
};

interface ServerModeSelectorProps {
  collapsed?: boolean;
  onOpenSettings?: (tab?: string) => void;
}

const ServerModeSelector: React.FC<ServerModeSelectorProps> = ({
  collapsed = false,
  onOpenSettings,
}) => {
  const { token } = theme.useToken();
  const appSettings = useSettingsStore(selectAppSettings);
  const installedServers = useSettingsStore(selectInstalledServers);
  const navigate = useNavigate();
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const runtimeSummaries = useProfileRuntimeSummaries();

  const currentServerId =
    appSettings?.server || installedServers[0]?.id || 'jartexnetwork';
  const currentMeta = installedServers.find(
    (s) => s.id === currentServerId,
  ) ?? {
    id: currentServerId,
    name: currentServerId,
    shortName: currentServerId,
    icon: null,
    color: '#8C8C8C',
    defaultIp: '',
    defaultPort: 25565,
    ips: [],
    gamemodes: [],
    kitGamemodes: [],
    defaultGamemode: '',
    custom: true,
    predefined: false,
  };

  const applyServerChange = (meta: ServerMeta) => {
    if (meta.id === currentServerId) return;
    switchServer(meta.id);
  };

  const serverItems: MenuProps['items'] = installedServers.map((meta) => {
    const runtime = runtimeSummaries[meta.id];
    const scripts = runtime?.scripts ?? 0;
    const bots = runtime?.bots ?? 0;
    const activity = [
      scripts > 0 ? `${scripts} ${scripts === 1 ? 'script' : 'scripts'}` : '',
      bots > 0 ? `${bots} ${bots === 1 ? 'bot' : 'bots'}` : '',
    ].filter(Boolean);

    return {
      key: meta.id,
      label: (
        <div
          style={{
            padding: '4px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 250,
          }}
        >
          {renderServerAvatar(meta, 18, 'square')}
          <span
            style={{
              fontWeight: meta.id === currentServerId ? '600' : '400',
              fontSize: '14px',
              color: meta.id === currentServerId ? meta.color : 'inherit',
              flex: 1,
            }}
          >
            {meta.name}
          </span>
          {activity.length > 0 && (
            <Space size={5}>
              <Badge status="success" />
              <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
                {activity.join(' · ')}
              </span>
            </Space>
          )}
          {meta.id === currentServerId && (
            <CheckOutlined style={{ color: meta.color, fontSize: 12 }} />
          )}
        </div>
      ),
      onClick: () => applyServerChange(meta),
      disabled: meta.id === currentServerId,
    };
  });

  const menuItems: MenuProps['items'] = [
    ...serverItems,
    { type: 'divider' as const },
    {
      key: '__marketplace__',
      label: 'Browse marketplace',
      icon: <AppstoreAddOutlined />,
      onClick: () => setMarketplaceOpen(true),
    },
    {
      key: '__new__',
      label: 'New profile',
      icon: <PlusOutlined />,
      onClick: () => navigate('/profiles/new'),
    },
    {
      key: '__manage__',
      label: 'Manage profiles',
      icon: <SettingOutlined />,
      onClick: () => {
        if (onOpenSettings) {
          onOpenSettings('profiles');
        } else {
          navigate('/profiles');
        }
      },
    },
  ];

  const scripts = runtimeSummaries[currentServerId]?.scripts ?? 0;
  const bots = runtimeSummaries[currentServerId]?.bots ?? 0;
  const isActive = scripts + bots > 0;

  return (
    <>
      <Dropdown
        menu={{ items: menuItems }}
        trigger={['click']}
        placement="bottomLeft"
      >
        <Button
          type="text"
          aria-label={`Switch profile. Current profile: ${currentMeta.name}`}
          style={
            collapsed
              ? {
                  width: 40,
                  minWidth: 40,
                  height: 40,
                  padding: 0,
                  borderRadius: token.borderRadiusLG,
                  background: token.colorBgElevated,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }
              : {
                  width: '100%',
                  height: 56,
                  padding: '8px 12px',
                  borderRadius: token.borderRadiusLG,
                  background: token.colorBgElevated,
                  display: 'flex',
                  alignItems: 'center',
                  textAlign: 'left',
                }
          }
        >
          {collapsed ? (
            <Badge dot={isActive} color={token.colorSuccess} offset={[-1, 27]}>
              {renderServerAvatar(currentMeta, 28, 'square')}
            </Badge>
          ) : (
            <Flex gap={12} align="center" style={{ width: '100%' }}>
              {renderServerAvatar(currentMeta, 34, 'square')}
              <Flex orientation="vertical" style={{ minWidth: 0, flex: 1 }}>
                <Typography.Text strong ellipsis>
                  {currentMeta.shortName}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {isActive
                    ? `${scripts} ${scripts === 1 ? 'script' : 'scripts'}`
                    : 'No activity'}
                </Typography.Text>
              </Flex>
              <LuChevronsUpDown
                size={14}
                color={token.colorTextTertiary}
                style={{ flexShrink: 0 }}
              />
            </Flex>
          )}
        </Button>
      </Dropdown>
      <ServerMarketplace
        open={marketplaceOpen}
        onClose={() => setMarketplaceOpen(false)}
      />
    </>
  );
};

export default ServerModeSelector;
