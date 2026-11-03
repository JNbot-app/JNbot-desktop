import { Flex, Radio, Switch, Typography, theme } from 'antd';
import {
  CHANGE_GLOBAL_SETTINGS,
  CUSTOM_DEFAULT_REMOTE_PERMISSIONS,
  DEFAULT_REMOTE_PERMISSIONS,
  FULL_REMOTE_PERMISSIONS,
  MANAGE_ACCESS,
  MANAGE_PLUGINS,
  MANAGE_PROFILES,
  STANDARD_REMOTE_PERMISSIONS,
  USE_ACCOUNTS,
  USE_ACTIVE_BOTS,
  USE_HOST_TOOLS,
  USE_SCRIPTS,
  hasRemotePermission,
  permissionPreset,
} from '../../../common/clientPermissions';

export { permissionPreset };

const { Text } = Typography;

const permissions = [
  [USE_ACCOUNTS, 'Accounts', 'View, edit, import, and use accounts'],
  [USE_SCRIPTS, 'Scripts', 'View, configure, start, and stop scripts'],
  [
    USE_ACTIVE_BOTS,
    'Active bots',
    'View and control bots for the selected profiles',
  ],
  [CHANGE_GLOBAL_SETTINGS, 'Global settings', 'Change settings shared by every profile'],
  [MANAGE_PLUGINS, 'Plugin library', 'Create, import, edit, export, and delete plugins'],
  [MANAGE_PROFILES, 'Profile catalog', 'Create, install, import, and delete profiles'],
  [MANAGE_ACCESS, 'Access & MCP administration', 'Manage access links, remote access, and MCP clients'],
  [USE_HOST_TOOLS, 'Host tools & data', 'Use backups, recordings, proxy, and Minecraft host tools'],
] as const;

interface PermissionEditorProps {
  value?: number;
  onChange?: (value: number) => void;
}

const PermissionEditor = ({ value = DEFAULT_REMOTE_PERMISSIONS, onChange }: PermissionEditorProps) => {
  const { token } = theme.useToken();
  const preset = permissionPreset(value);

  const setPreset = (next: 'standard' | 'custom' | 'full') => {
    if (next === 'standard') {
      onChange?.(DEFAULT_REMOTE_PERMISSIONS);
    } else if (next === 'full') {
      onChange?.(FULL_REMOTE_PERMISSIONS);
    } else {
      onChange?.(
        (value === FULL_REMOTE_PERMISSIONS ? DEFAULT_REMOTE_PERMISSIONS : value) &
          ~STANDARD_REMOTE_PERMISSIONS,
      );
    }
  };

  const setPermission = (flag: number, enabled: boolean) => {
    const currentBase =
      (value === FULL_REMOTE_PERMISSIONS ? DEFAULT_REMOTE_PERMISSIONS : value) &
      ~STANDARD_REMOTE_PERMISSIONS;
    const next = enabled ? currentBase | flag : currentBase & ~flag;
    onChange?.(next);
  };

  return (
    <Flex vertical gap={token.marginSM}>
      <Radio.Group value={preset} onChange={(event) => setPreset(event.target.value)} optionType="button" buttonStyle="solid">
        <Radio.Button value="standard">Standard</Radio.Button>
        <Radio.Button value="custom">Custom</Radio.Button>
        <Radio.Button value="full">Full access</Radio.Button>
      </Radio.Group>
      <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
        Standard access can control the selected profiles. Full access includes future permissions.
      </Text>
      {preset === 'custom' && (
        <Flex vertical gap={token.marginSM}>
          {permissions.map(([flag, title, description]) => (
            <Flex key={flag} align="center" justify="space-between" gap={token.marginMD}>
              <div>
                <Text>{title}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>{description}</Text>
              </div>
              <Switch
                checked={hasRemotePermission(value, flag)}
                onChange={(checked) => setPermission(flag, checked)}
              />
            </Flex>
          ))}
        </Flex>
      )}
    </Flex>
  );
};

export default PermissionEditor;
