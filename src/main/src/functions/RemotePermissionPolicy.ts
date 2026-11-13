import {
  CHANGE_GLOBAL_SETTINGS,
  MANAGE_ACCESS,
  MANAGE_PLUGINS,
  MANAGE_PROFILES,
  USE_ACCOUNTS,
  USE_ACTIVE_BOTS,
  USE_HOST_TOOLS,
  USE_SCRIPTS,
  RemotePermission,
  type RemotePermissionFlag,
} from '../../../common/clientPermissions';

export type OperationRestriction =
  | RemotePermissionFlag
  | readonly RemotePermissionFlag[]
  | 'unsupported-remote'
  /** Action missing from the policy: only full-access clients may call it. */
  | 'not-listed';

/** Allowed for every paired client. */
const NO_PERMISSION: readonly RemotePermissionFlag[] = [];

function buildRestrictions(
  groups: readonly [OperationRestriction, readonly string[]][],
): Readonly<Record<string, OperationRestriction>> {
  const result: Record<string, OperationRestriction> = {};
  for (const [restriction, events] of groups) {
    for (const event of events) result[event] = restriction;
  }
  return result;
}

const clientActions = buildRestrictions([
  [
    NO_PERMISSION,
    [
      'PING', 'ERROR', 'GET_BOOTSTRAP', 'GET_JNDATA', 'GET_MACROS',
      'GET_MINECRAFT_VERSIONS', 'LLM_STATUS', 'LLM_CANCEL',
      // These verify the caller themselves (host prompt / mobile runtime).
      'REQUEST_INSTANCE_TRANSFER', 'READ_INSTANCE_TRANSFER_CHUNK',
      'COMPLETE_INSTANCE_TRANSFER', 'CANCEL_INSTANCE_TRANSFER',
      'MOBILE_INSTANCE_TRANSFER_BEGIN', 'MOBILE_INSTANCE_TRANSFER_APPEND',
      'MOBILE_INSTANCE_TRANSFER_FINISH', 'MOBILE_INSTANCE_TRANSFER_CANCEL',
    ],
  ],
  // Replaces the whole instance, including devices and their permissions.
  [Object.values(RemotePermission), ['IMPORT_SETTINGS']],
  [USE_ACCOUNTS, ['GET_UUID', 'ALT_CREATED', 'ALTS_OF_PROFILE', 'MC_LOGIN_MICROSOFT']],
  [
    USE_SCRIPTS,
    [
      'SCRIPT_PROGRESS', 'STOP', 'STOP_ALL', 'RESTART_ALL', 'SCRIPT_CONTROL',
      'GET_LOGS', 'CLEAR_CONSOLE', 'SERVER_STATUS_UPDATE', 'SERVER_STATUS',
      'GET_SCRIPT_ACTIONS', 'UPDATE_PLUGIN_DATA', 'LLM_EXPLAIN_ERROR',
    ],
  ],
  [[USE_SCRIPTS, USE_ACCOUNTS], ['START_SCRIPT', 'LAUNCH_MINECRAFT']],
  [USE_ACTIVE_BOTS, ['BOT_ACTION', 'JOIN_BOT_NOW']],
  [
    MANAGE_PLUGINS,
    [
      'EXPORT_PORTABLE_PLUGIN', 'PREVIEW_PORTABLE_PLUGINS',
      'IMPORT_PORTABLE_PLUGINS', 'CREATE_MACRO', 'MACRO_CODE',
      'SAVE_MACRO', 'SAVE_MACRO_INFO',
      'DUPLICATE_MACRO', 'MIGRATE_MACRO_TO_RECIPE',
      'UPDATE_PLUGIN_METADATA', 'IMPORT_MACRO_FILE',
      'GET_PUBLISHER_IDENTITY', 'SET_PUBLISHER_NAME',
      'GET_TRUSTED_PUBLISHERS', 'REMOVE_TRUSTED_PUBLISHER',
      'SHARE_STATE', 'SHARE_CHECK_UPDATES', 'SHARE_PREVIEW', 'SHARE_INSTALL',
      'SHARE_MARKET', 'SHARE_REPORT', 'LLM_ASK_SHARE', 'LLM_WRITE_PLUGIN',
    ],
  ],
  [
    MANAGE_PROFILES,
    [
      'CREATE_CUSTOM_PROFILE', 'DELETE_PROFILE', 'PING_MINECRAFT_SERVER',
      'IMPORT_SYNCED_PROFILES',
    ],
  ],
  [
    MANAGE_ACCESS,
    [
      'CREATE_DEVICE', 'UPDATE_DEVICE', 'UPDATE_DEVICE_PERMISSIONS',
      'REMOVE_DEVICE', 'CLOSE_CONNECTION', 'TURN_ON_SERVER',
      'TURN_OFF_SERVER', 'START_PEER_TO_PEER', 'STOP_PEER_TO_PEER',
      'MCP_STATUS', 'MCP_ENABLE', 'MCP_DISABLE', 'MCP_EMERGENCY_STOP',
      'MCP_PAIR_CLIENT', 'MCP_UPDATE_CLIENT', 'MCP_ROTATE_TOKEN',
      'MCP_TEST_CLIENT', 'MCP_REMOVE_CLIENT', 'MCP_DECIDE_APPROVAL',
      'MCP_CLEAR_AUDIT',
    ],
  ],
  [CHANGE_GLOBAL_SETTINGS, ['SET_DEFAULT_PROFILE', 'LLM_SET_CONFIG', 'LLM_TEST', 'LLM_MODELS']],
  [
    USE_HOST_TOOLS,
    [
      'EXPORT_SETTINGS', 'GET_RECORDINGS',
      'DELETE_RECORDING', 'RENAME_RECORDING', 'GET_RECORDING_DATA',
      'UPDATE_RECORDING_NAME', 'UPDATE_RECORDING_DATA',
      'START_AUTOMATION_RECORDING', 'START_AUTOMATION_REPLAY',
      'AUTOMATION_SESSION_CONTROL', 'GET_AUTOMATION_SESSIONS',
      'GET_BRAIN_INFO', 'GET_BRAIN_MODEL', 'DELETE_BRAIN_EXAMPLE',
      'USE_AUTOMATION_TAKE',
      'START_BRAIN_PRACTICE',
      'GET_MC_LAUNCH_LOGS', 'CLEAR_MC_LAUNCH_LOGS', 'LAUNCHER_MODS',
      'ADD_MINECRAFT_MOD', 'REMOVE_MINECRAFT_MOD',
      'GET_FEATURED_MINECRAFT_MODS', 'GET_MOD_PROJECT',
      'SEARCH_MINECRAFT_MODS', 'MC_BRIDGE_LIST_CLIENTS',
      'MC_BRIDGE_BROADCAST_COMMAND', 'MC_BRIDGE_SEND_COMMAND',
      'MC_SERVERS_LIST', 'MC_SERVER_GET', 'MC_SERVER_WORLDS',
      'MC_SERVER_BRIDGE_CLIENTS', 'MC_SERVER_CREATE',
      'MC_SERVER_SHARE_CLIENT', 'MC_SERVER_SHARE_LAN',
      'MC_SERVER_IMPORT_INVITE', 'MC_SERVER_REMOVE', 'MC_SERVER_START',
      'MC_SERVER_STOP', 'MC_SERVER_RESTART', 'MC_SERVER_INVITE',
      'MC_SERVER_ROTATE_INVITE', 'MC_SERVER_CONSOLE_LINES',
      'MC_SERVER_CONSOLE_COMMAND', 'MC_SERVER_PLUGINS_LIST',
      'MC_SERVER_PLUGINS_SEARCH', 'MC_SERVER_PLUGIN_PROJECT',
      'MC_SERVER_PLUGIN_INSTALL', 'MC_SERVER_PLUGIN_REMOVE',
      'CLOUD_STORAGE_INFO', 'CLOUD_STORAGE_UPLOAD',
      'CLOUD_STORAGE_GENERATE_KEY', 'CLOUD_STORAGE_IMPORT',
      'CLOUD_STORAGE_REMOVE', 'JN_FETCH',
    ],
  ],
  [
    'unsupported-remote',
    [
      'SELECT_DIRECTORY', 'OPEN_CONSOLE_LOGS', 'OPEN_PLUGIN_EXTERNAL',
      'IMPORT_MACRO', 'EXPORT_MACRO', 'BUTTON_POPUP', 'OPEN_URL', 'EXIT_APP',
      // Shares are signed with this installation's publisher (or reviewer) key.
      'SHARE_CREATE', 'SHARE_HAS_CHANGES', 'SHARE_UPDATE', 'SHARE_DELETE',
      'SHARE_VISIBILITY', 'SHARE_REVIEW_QUEUE', 'SHARE_REVIEW',
    ],
  ],
]);

const profileActions = buildRestrictions([
  [
    USE_ACCOUNTS,
    [
      'ALT_UPDATE', 'ALT_UPSERT', 'ALT_DELETE', 'ALTS_OF_PROFILE',
      'IMPORT_ALTS_FROM_PROFILE', 'MC_LOGIN_MICROSOFT', 'MC_LOGOUT_MICROSOFT',
    ],
  ],
  [
    USE_SCRIPTS,
    [
      'SCRIPT_PROGRESS', 'STOP', 'STOP_ALL', 'RESTART_ALL',
      'SCRIPT_CONTROL', 'GET_LOGS', 'CLEAR_CONSOLE',
      'SERVER_STATUS_UPDATE', 'SERVER_STATUS', 'GET_SCRIPT_ACTIONS',
      'SETTINGS_UPDATE', 'SET_SETTINGS', 'SET_APPSETTINGS',
      'APPSETTINGS_UPDATE', 'UPDATE_PLUGIN_DATA',
      'RESOLVE_PROFILE_SCRIPT_INFO', 'RESOLVE_PLUGIN_RUN_DESCRIPTOR',
      'LLM_GENERATE',
    ],
  ],
  [[USE_SCRIPTS, USE_ACCOUNTS], ['START_SCRIPT', 'LAUNCH_MINECRAFT']],
  [USE_ACTIVE_BOTS, ['BOT_ACTION', 'JOIN_BOT_NOW']],
  [MANAGE_PLUGINS, ['DELETE_MACRO']],
  [MANAGE_PROFILES, ['EXPORT_PORTABLE_PROFILE']],
  ['unsupported-remote', ['OPEN_CONSOLE_LOGS']],
]);

const clientSubscriptions = buildRestrictions([
  [MANAGE_ACCESS, ['devices', 'MCP_ACTIVITY']],
  [USE_HOST_TOOLS, ['RECORDINGS']],
]);

const profilePublications = buildRestrictions([
  [USE_SCRIPTS, ['activeScripts', 'PROGRESS_UPDATE']],
  [USE_ACTIVE_BOTS, ['activeBots']],
]);

const invokes = buildRestrictions([
  [
    USE_SCRIPTS,
    ['profile-script-resolve', 'profile-script-resolve-info', 'profile-script-checksum'],
  ],
  [[USE_SCRIPTS, USE_ACCOUNTS], ['profile-ui-run']],
  [MANAGE_PLUGINS, ['profile-script-save-info', 'profile-plugin-install']],
  [
    MANAGE_PROFILES,
    [
      'profile-script-fetch-url',
      'profile-ui-preview', 'profile-ui-preview-code',
    ],
  ],
  [
    'unsupported-remote',
    ['profile-script-pick-file', 'profile-export', 'profile-import'],
  ],
]);

const sends = buildRestrictions([
  [MANAGE_PROFILES, ['profiles-update']],
  [USE_ACTIVE_BOTS, ['DIALOG']],
  ['unsupported-remote', ['install-update']],
]);

/**
 * Actions dispatch straight to backend handlers, so a missing entry is
 * denied. For the other kinds a missing entry intentionally means allowed.
 */
export const remoteRestriction = {
  clientAction: (event: string): OperationRestriction =>
    clientActions[event.toUpperCase()] ?? 'not-listed',
  profileAction: (event: string): OperationRestriction =>
    profileActions[event.toUpperCase()] ?? 'not-listed',
  clientSubscription: (event: string) => clientSubscriptions[event],
  profilePublication: (event: string) => profilePublications[event],
  invoke: (channel: string) => invokes[channel],
  send: (channel: string, data: unknown): OperationRestriction | undefined => {
    if (channel !== 'shared-update') return sends[channel];
    return data !== null &&
      typeof data === 'object' &&
      'pluginMetadata' in data
      ? MANAGE_PLUGINS
      : USE_HOST_TOOLS;
  },
} as const;
