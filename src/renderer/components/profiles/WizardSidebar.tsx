import { Avatar, Badge, Flex, Menu, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  CheckOutlined,
  CloudServerOutlined,
  CodeOutlined,
  CrownOutlined,
  SlidersOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { CustomProfile } from '../../../common/profiles';
import { withAlpha } from '../intro/introUtils';
import { formatAddress, initialsOf, isSectionConfigured, SectionKey } from './wizardUtils';

const { Text } = Typography;

const SCRIPTING: { key: SectionKey; label: string }[] = [
  { key: 'scripts', label: 'Dashboard scripts' },
  { key: 'profileUi', label: 'Player stats' },
  { key: 'botExtension', label: 'Bot action' },
];

interface Props {
  profile: CustomProfile;
  current: SectionKey;
  onSelect: (key: SectionKey) => void;
  serverInvalid: boolean;
}

const WizardSidebar = ({ profile, current, onSelect, serverInvalid }: Props) => {
  const { token } = theme.useToken();
  const { name, color, icon, defaultIp, defaultPort } = profile.data;

  const item = (key: SectionKey, label: string, iconNode?: ReactNode) => ({
    key,
    label,
    icon: iconNode,
    extra:
      key === 'server' && serverInvalid ? (
        <Badge status="error" />
      ) : isSectionConfigured(profile, key) ? (
        <CheckOutlined style={{ color: token.colorTextTertiary, fontSize: 12 }} />
      ) : undefined,
  });

  const items: MenuProps['items'] = [
    item('server', 'Server', <CloudServerOutlined />),
    item('gamemodes', 'Gamemodes', <AppstoreOutlined />),
    { type: 'divider' },
    item('ranks', 'Ranks & kits', <CrownOutlined />),
    item('appSettings', 'Default settings', <SlidersOutlined />),
    {
      key: 'scripting',
      label: 'Scripting',
      icon: <CodeOutlined />,
      children: SCRIPTING.map((s) => item(s.key, s.label)),
    },
  ];

  const scriptingUsed = SCRIPTING.some(
    (s) => s.key === current || isSectionConfigured(profile, s.key),
  );

  return (
    <div style={{ width: 240, flexShrink: 0, overflow: 'auto', height: '100%' }}>
      <Flex align="center" gap={token.marginSM} style={{ padding: `0 ${token.paddingSM}px ${token.padding}px` }}>
        <Avatar
          shape="square"
          size={40}
          src={icon || undefined}
          style={{
            flexShrink: 0,
            background: withAlpha(color, 0.25),
            color,
            fontWeight: 600,
          }}
        >
          {initialsOf(name || '?')}
        </Avatar>
        <div style={{ minWidth: 0 }}>
          <Text strong ellipsis style={{ display: 'block' }}>
            {name || 'New server'}
          </Text>
          <Text type="secondary" ellipsis style={{ display: 'block' }}>
            {formatAddress(defaultIp ?? '', defaultPort) || 'No address yet'}
          </Text>
        </div>
      </Flex>

      <Menu
        mode="inline"
        items={items}
        selectedKeys={[current]}
        defaultOpenKeys={scriptingUsed ? ['scripting'] : []}
        onClick={({ key }) => onSelect(key as SectionKey)}
        style={{ borderInlineEnd: 'none', background: 'transparent' }}
      />
    </div>
  );
};

export default WizardSidebar;
