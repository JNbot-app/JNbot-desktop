/** Stable profile keys allowed to a remote client. `*` includes future profiles. */
export type ProfileGrant = '*' | string[];

/**
 * Remote UI permissions use JavaScript's signed 32-bit bitwise domain. Keep
 * these values stable: persisted access links and mobile clients share them.
 */
/** Marks the Standard preset without granting any elevated capability. */
export const STANDARD_REMOTE_PERMISSIONS = 1 << 0;
export const CHANGE_GLOBAL_SETTINGS = 1 << 1;
export const MANAGE_PLUGINS = 1 << 2;
export const MANAGE_PROFILES = 1 << 3;
export const MANAGE_ACCESS = 1 << 4;
export const USE_HOST_TOOLS = 1 << 5;
export const USE_ACTIVE_BOTS = 1 << 6;
export const USE_ACCOUNTS = 1 << 7;
export const USE_SCRIPTS = 1 << 8;

export const RemotePermission = {
  CHANGE_GLOBAL_SETTINGS,
  MANAGE_PLUGINS,
  MANAGE_PROFILES,
  MANAGE_ACCESS,
  USE_HOST_TOOLS,
  USE_ACTIVE_BOTS,
  USE_ACCOUNTS,
  USE_SCRIPTS,
} as const;

export type RemotePermissionFlag =
  (typeof RemotePermission)[keyof typeof RemotePermission];

/** The Standard preset may gain further bits in a later version. */
export const DEFAULT_REMOTE_PERMISSIONS =
  STANDARD_REMOTE_PERMISSIONS |
  USE_ACCOUNTS |
  USE_SCRIPTS |
  USE_ACTIVE_BOTS;
/** Baseline capabilities for Custom presets (starts from Standard capabilities without the Standard preset bit). */
export const CUSTOM_DEFAULT_REMOTE_PERMISSIONS =
  USE_ACCOUNTS | USE_SCRIPTS | USE_ACTIVE_BOTS;
/** `~0` deliberately includes permissions introduced by future versions. */
export const FULL_REMOTE_PERMISSIONS = ~0;

export function permissionPreset(mask: number): 'standard' | 'custom' | 'full' {
  if (mask === FULL_REMOTE_PERMISSIONS) return 'full';
  if ((mask & STANDARD_REMOTE_PERMISSIONS) !== 0 || mask === DEFAULT_REMOTE_PERMISSIONS) {
    return 'standard';
  }
  return 'custom';
}

export type McpPermission = 'deny' | 'ask' | 'allow';
export type McpObservePermission = 'deny' | 'allow';

export interface McpPermissions {
  enabled: boolean;
  observe: McpObservePermission;
  control: McpPermission;
  code: McpPermission;
  plugins: McpPermission;
}

export const defaultMcpPermissions = (): McpPermissions => ({
  enabled: false,
  observe: 'allow',
  control: 'allow',
  code: 'ask',
  plugins: 'ask',
});

export interface ClientPermissions {
  profiles: ProfileGrant;
  permissionMask: number;
  mcp: McpPermissions;
}

export interface ClientPrincipal {
  kind: 'trusted-local' | 'remote';
  subjectId: string;
  permissions: ClientPermissions;
}

export const unrestrictedPermissions = (): ClientPermissions => ({
  profiles: '*',
  permissionMask: FULL_REMOTE_PERMISSIONS,
  mcp: { enabled: true, observe: 'allow', control: 'allow', code: 'allow', plugins: 'allow' },
});

export function hasRemotePermission(
  permissionMask: number,
  permission: RemotePermissionFlag,
): boolean {
  return (permissionMask & permission) === permission;
}

export const REMOTE_CAPABILITIES = {
  accounts: 'accounts',
  scripts: 'scripts',
  activeBots: 'activeBots',
  plugins: 'plugins',
  globalSettings: 'globalSettings',
  profiles: 'profiles',
  access: 'access',
  hostTools: 'hostTools',
} as const;

export type RemoteCapability =
  (typeof REMOTE_CAPABILITIES)[keyof typeof REMOTE_CAPABILITIES];

export const REMOTE_CAPABILITY_FLAGS = {
  [REMOTE_CAPABILITIES.accounts]: USE_ACCOUNTS,
  [REMOTE_CAPABILITIES.scripts]: USE_SCRIPTS,
  [REMOTE_CAPABILITIES.activeBots]: USE_ACTIVE_BOTS,
  [REMOTE_CAPABILITIES.plugins]: MANAGE_PLUGINS,
  [REMOTE_CAPABILITIES.globalSettings]: CHANGE_GLOBAL_SETTINGS,
  [REMOTE_CAPABILITIES.profiles]: MANAGE_PROFILES,
  [REMOTE_CAPABILITIES.access]: MANAGE_ACCESS,
  [REMOTE_CAPABILITIES.hostTools]: USE_HOST_TOOLS,
} as const satisfies Record<RemoteCapability, RemotePermissionFlag>;

export interface RemoteAccessCapabilities {
  allowed: RemoteCapability[];
  canUseAccounts: boolean;
  canUseScripts: boolean;
  canUseActiveBots: boolean;
  canUsePlugins: boolean;
  canChangeGlobalSettings: boolean;
  canManageProfiles: boolean;
  canManageAccess: boolean;
  canUseHostTools: boolean;
  can: (capability: RemoteCapability) => boolean;
}

export function hasRemoteCapability(
  permissionMask: number,
  capability: RemoteCapability,
): boolean {
  return hasRemotePermission(
    permissionMask,
    REMOTE_CAPABILITY_FLAGS[capability],
  );
}

/** Client-friendly capabilities derived from the server-enforced bitmask. */
export function remoteAccessCapabilities(
  permissionMask: number,
): RemoteAccessCapabilities {
  const allowed = Object.values(REMOTE_CAPABILITIES).filter((capability) =>
    hasRemoteCapability(permissionMask, capability),
  );
  return {
    allowed,
    canUseAccounts: allowed.includes(REMOTE_CAPABILITIES.accounts),
    canUseScripts: allowed.includes(REMOTE_CAPABILITIES.scripts),
    canUseActiveBots: allowed.includes(REMOTE_CAPABILITIES.activeBots),
    canUsePlugins: allowed.includes(REMOTE_CAPABILITIES.plugins),
    canChangeGlobalSettings: allowed.includes(REMOTE_CAPABILITIES.globalSettings),
    canManageProfiles: allowed.includes(REMOTE_CAPABILITIES.profiles),
    canManageAccess: allowed.includes(REMOTE_CAPABILITIES.access),
    canUseHostTools: allowed.includes(REMOTE_CAPABILITIES.hostTools),
    can: (capability: RemoteCapability) => allowed.includes(capability),
  };
}

export function assertRemotePermission(
  permissionMask: number,
  permission: RemotePermissionFlag,
): void {
  if (!hasRemotePermission(permissionMask, permission))
    throw new Error('You do not have permission to perform this operation.');
}

export function normalizePermissionMask(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < -0x80000000 ||
    value > 0x7fffffff
  )
    return DEFAULT_REMOTE_PERMISSIONS;
  // Version one used `1` as the complete Standard preset. Preserve those
  // existing access links when Standard gains explicit baseline capabilities.
  const previousStandardMask = STANDARD_REMOTE_PERMISSIONS | USE_ACTIVE_BOTS;
  return value === STANDARD_REMOTE_PERMISSIONS || value === previousStandardMask
    ? DEFAULT_REMOTE_PERMISSIONS
    : value;
}

export function normalizePermissions(value: unknown): ClientPermissions {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<ClientPermissions>;
  return {
    profiles: raw.profiles === '*'
      ? '*'
      : Array.isArray(raw.profiles)
        ? [...new Set(raw.profiles.filter((key): key is string => typeof key === 'string' && key.length > 0))]
        : '*',
    permissionMask: normalizePermissionMask(raw.permissionMask),
    mcp: normalizeMcpPermissions(raw.mcp),
  };
}

function normalizeMcpPermissions(value: unknown): McpPermissions {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<McpPermissions>;
  return {
    enabled: raw.enabled === true,
    observe: raw.observe === 'deny' ? 'deny' : 'allow',
    control: raw.control === 'allow' || raw.control === 'ask' ? raw.control : 'allow',
    code: raw.code === 'allow' || raw.code === 'ask' ? raw.code : 'ask',
    plugins: raw.plugins === 'allow' || raw.plugins === 'ask' ? raw.plugins : 'ask',
  };
}
