import type { BrainLearnSettings } from '../../../common/brainSpec';
import {
  MacroInfo,
  MacroCode,
  Db,
  Device,
  ScriptOptions,
  Alt,
  AltWithData,
  MacroScriptType,
  MacroLanguage,
  LaunchMinecraftOptions,
  Origin,
  PluginData,
  PluginMetadata,
  SettingsObj,
  AppSettings,
} from '../types';
import { ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { getPlatform } from '../platform';
import uuid from './actions/uuid';
import { app } from 'electron';
import { Socket } from './peer2peer/Socket';
import { invokeHandler } from './ipcHandle';
import jnFetch from './actions/jartexRequest';
import ScriptHandler_, { ScriptDataType } from './ScriptHandler';
import { getServerStatus } from './minecraft/pingServer';
import CloudStorage from './storage/CloudStorage';
import InstanceTransferService from './InstanceTransferService';
import MobileInstanceTransferReceiver from './MobileInstanceTransferReceiver';
import Settings_ from './Settings';
import { removeMinecraftAuth } from './minecraft/MinecraftAccountService';
import { ServerTypes } from './peer2peer/DeviceHandler';
import Macros_, { MacroDatabase } from './Macros';
import WindowHandler_ from './WindowHandler';
import { getMcBridgeServer } from './minecraft/bridge';
import { SearchProjectOptions } from '@xmcl/modrinth';
import { backendMessaging } from '../messaging';
import AccessControl from './AccessControl';
import type { Address } from '../../../common/messaging';
import {
  MANAGE_PROFILES,
  USE_ACCOUNTS,
  USE_ACTIVE_BOTS,
  USE_SCRIPTS,
  normalizePermissions,
} from '../../../common/clientPermissions';
import { isProfileSpecificSetting } from '../../../common/appSettingsSchema';
import type { ProfileScript } from '../../../common/profileScripts';
import { isPluginDisallowed } from '../../../common/profiles';
import {
  accountAuthenticationError,
  isOnlineMode,
} from '../../../common/serverAuthentication';
import { isSensitivePluginOption, type PluginOption } from '../../../common/pluginOptions';
import type ProfileRuntime from './ProfileRuntime';
import { pluginSecurity } from './signing';
import { PROFILE_ACTIONS } from '../../../common/profileActions';
import type {
  CreateMinecraftServerInput,
  ShareMinecraftClientWorldInput,
  ShareMinecraftLanInput,
} from '../../../common/minecraftServers';
import { RecipeDocumentV3 } from 'common/recipeV3';
import type {
  AutomationReplayOptions,
  AutomationTargetDescriptor,
} from 'common/automation';
import EventEmitter from 'node:events';
import type McpManager from './mcp/McpManager';
import { createClientBootstrap } from '../messaging/bootstrap';
import ShareService from './share/ShareService';
import type {
  ShareCreateInput,
  ShareInstallInput,
  SharePreviewInput,
  ShareReviewInput,
  ShareVisibilityInput,
} from '../../../common/share';
import ProfileTransfer, {
  type PortableProfilePackage,
} from './ProfileTransfer';
import { createCustomProfile } from '../../../common/createCustomProfile';
import type { CreateProfileInput } from '../../../common/mobileClientContract';
import type {
  InstanceTransferChunk,
  InstanceTransferManifest,
  PluginImportDecision,
  PortablePluginPackage,
} from '../../../common/mobileClientContract';

/**
 * Build the per-request origin handed to `ipcMain.on` handlers for a message
 * that arrived from a remote client (p2p today, websocket later — anything
 * implementing the `Socket` interface). It mirrors Electron's `IpcMainEvent`:
 * handlers call `origin.reply(channel, data)` to answer the requester, and
 * read `origin.sockets` to know the message came from a remote client. New
 * transports need no change here — they only implement `Socket`.
 */
function socketOrigin(socket: Socket): Origin {
  return {
    sockets: true,
    socket,
    reply: (channel, data) => socket.emit(channel, data),
  };
}

class ClientEvents_ {
  settings: Settings_;
  scriptHandler: ScriptHandler_;
  macros: Macros_;
  db: MacroDatabase;
  windowHandler: WindowHandler_;
  registeredSockets: Set<Socket> = new Set();
  mcpManager?: McpManager;
  readonly accessControl: AccessControl;
  readonly profileTransfer: ProfileTransfer;
  readonly shares: ShareService;
  readonly instanceTransfer: InstanceTransferService;
  readonly mobileInstanceTransfer = new MobileInstanceTransferReceiver();

  constructor(
    settings: Settings_,
    scriptHandler: ScriptHandler_,
    macros: Macros_,
    windowHandler: WindowHandler_,
  ) {
    this.windowHandler = windowHandler;
    this.settings = settings;
    this.scriptHandler = scriptHandler;
    this.macros = macros;
    this.db = macros.db;
    this.accessControl = new AccessControl(settings, scriptHandler);
    this.profileTransfer = new ProfileTransfer(settings);
    this.shares = new ShareService(
      { settings, macros, profileTransfer: this.profileTransfer },
      (state) => global.send('shares', state),
    );
    this.shares
      .adoptOfficialProfiles()
      .catch((error) => console.warn('Linking profiles to the marketplace failed', error));
    settings.on('profile:loaded', (profileKey: string) =>
      this.shares.checkProfile(profileKey).catch((error) => console.warn('Profile update check failed', error)),
    );
    // Marketplace installs update on their own, also when no share page is
    // open. checkUpdates itself only asks the server once a day.
    const checkShares = () =>
      this.shares.checkUpdates().catch((error) => console.warn('Share update check failed', error));
    checkShares();
    setInterval(checkShares, 60 * 60 * 1000).unref?.();
    this.instanceTransfer = new InstanceTransferService(settings);
    this.events();
    const serv: string | undefined = process.env.JNBOT_SERVER;
    if (typeof serv === 'string') {
      setTimeout(async () => {
        if (this.scriptHandler.deviceHandler) {
          // Check if serv is a valid `ServerTypes` type
          await this.scriptHandler.deviceHandler.start(
            serv as unknown as ServerTypes,
          );
          const device = this.scriptHandler.deviceHandler.ensureDefaultDevice();
          console.info('====== REMOTE ACCESS ======');
          console.info('Device ID: ', device.id);
          console.info('Device token', device.token);
          console.info('==========================');
        }
      }, 5000);
    }
  }

  action(
    action: string,
    data?: any,
    event: IpcMainEvent | IpcMainInvokeEvent | null = null,
    originAddress?: Address,
  ) {
    action = action.toUpperCase() as keyof ClientEvents_;
    if (PROFILE_ACTIONS.has(action)) {
      throw new Error(`profileId is required for ${action}`);
    }
    this.accessControl.assertClientAction(originAddress, action);
    // @ts-ignore
    if (action in this) return this[action](data, event, originAddress);
    else console.error('Unknown action', action);
    return {};
  }

  GET_BOOTSTRAP(
    _input?: unknown,
    _event?: IpcMainEvent | IpcMainInvokeEvent | null,
    originAddress?: Address,
  ) {
    return createClientBootstrap(
      this.settings,
      this.accessControl.principal(originAddress),
    );
  }

  UPDATE_PLUGIN_METADATA(pluginMetadata: PluginMetadata) {
    this.settings.updateShared({ pluginMetadata }, true);
    return this.settings.shared.pluginMetadata;
  }

  async enableProfile(profileKey: string, originAddress?: Address) {
    this.accessControl.assertProfile(originAddress, profileKey);
    const runtime = this.scriptHandler.enableProfile(profileKey);
    void this.scriptHandler.updateActiveIps(runtime.profileId).catch((error) =>
      console.warn('Failed to refresh active IPs', error),
    );
    return { profileId: runtime.profileId, profileKey: runtime.profileKey };
  }

  MCP_STATUS() {
    return this.requireMcpManager().snapshot();
  }

  MCP_ENABLE(data?: { mode?: 'local' | 'remote' }) {
    return this.requireMcpManager().enable(data?.mode ?? 'local');
  }

  MCP_DISABLE() {
    return this.requireMcpManager().disable();
  }

  MCP_EMERGENCY_STOP() {
    return this.requireMcpManager().emergencyStop();
  }

  MCP_PAIR_CLIENT(data: {
    name: string;
    provider: 'chatgpt' | 'claude' | 'local' | 'custom';
    profileKeys: string[];
    accounts?: string[];
  }) {
    return this.requireMcpManager().createClient(data);
  }

  MCP_UPDATE_CLIENT(data: {
    clientId: string;
    update: Record<string, unknown>;
  }) {
    return this.requireMcpManager().updateClient(
      data.clientId,
      data.update as any,
    );
  }

  MCP_ROTATE_TOKEN(data: { clientId: string }) {
    return this.requireMcpManager().rotateClientToken(data.clientId);
  }

  MCP_TEST_CLIENT(data: { clientId: string }) {
    return this.requireMcpManager().testClient(data.clientId);
  }

  MCP_REMOVE_CLIENT(data: { clientId: string }) {
    return this.requireMcpManager().removeClient(data.clientId);
  }

  MCP_DECIDE_APPROVAL(data: {
    approvalId: string;
    approved: boolean;
    rememberFor15Minutes?: boolean;
    profileKeys?: string[];
  }) {
    return this.requireMcpManager().decideApproval(
      data.approvalId,
      data.approved,
      data.profileKeys,
    );
  }

  MCP_CLEAR_AUDIT() {
    this.requireMcpManager().clearAudit();
    return true;
  }

  private requireMcpManager(): McpManager {
    if (!this.mcpManager) throw new Error('MCP is still starting.');
    return this.mcpManager;
  }

  profileSnapshot(profileId: number, originAddress?: Address) {
    const runtime = this.scriptHandler.getRuntime(profileId);
    this.accessControl.assertProfile(originAddress, runtime.profileKey);
    const canUseAccounts = this.accessControl.hasPermission(
      originAddress,
      USE_ACCOUNTS,
    );
    const canUseScripts = this.accessControl.hasPermission(
      originAddress,
      USE_SCRIPTS,
    );
    const canUseActiveBots = this.accessControl.hasPermission(
      originAddress,
      USE_ACTIVE_BOTS,
    );
    const settings = this.settings.getProfileSettings(runtime.profileKey);
    const visibleSettings = {
      ...settings,
      ...(!canUseAccounts ? { altData: {}, altTags: [] } : {}),
      ...(!canUseScripts
        ? { scripts: {}, pluginData: {}, triggers: [] }
        : {}),
    };
    return {
      profileId,
      profileKey: runtime.profileKey,
      settings: visibleSettings,
      appSettings: this.settings.getProfileAppSettings(runtime.profileKey),
      activeScripts: canUseScripts ? runtime.activeScripts.toObject() : {},
      activeBots: canUseActiveBots ? runtime.activeBots.toArray() : [],
      activeScriptActions: canUseScripts
        ? runtime.scriptActionHandler.activeActions
        : {},
      alts: canUseAccounts
        ? this.settings.getAltsWithDataForProfile(runtime.profileKey)
        : [],
      stats: this.settings.stats.mobileActivity(),
      progress: canUseScripts ? runtime.activeScripts.getProgress() : {},
      serverStatus: { ips: runtime.workingIps },
    };
  }

  async IMPORT_SYNCED_PROFILES(input: {
    packages?: PortableProfilePackage[];
  }, _event?: IpcMainEvent | IpcMainInvokeEvent | null, originAddress?: Address) {
    const packages = Array.isArray(input?.packages) ? input.packages : [];
    const result = await this.profileTransfer.import(packages);
    for (const profile of result.installed ?? [])
      this.grantCreatedProfile(originAddress, profile.profileKey);
    return {
      ...result,
      bootstrap: createClientBootstrap(this.settings),
    };
  }

  EXPORT_PORTABLE_PLUGIN(input: { pluginId?: unknown }) {
    const pluginId = typeof input?.pluginId === 'string' ? input.pluginId : '';
    return this.macros.exportPortablePlugin(pluginId);
  }

  PREVIEW_PORTABLE_PLUGINS(input: { packages?: unknown }) {
    const packages = Array.isArray(input?.packages) ? input.packages : [];
    return this.macros.previewPortablePlugins(packages as PortablePluginPackage[] as any);
  }

  IMPORT_PORTABLE_PLUGINS(input: {
    packages?: unknown;
    decisions?: unknown;
  }) {
    const packages = Array.isArray(input?.packages) ? input.packages : [];
    const decisions = Array.isArray(input?.decisions) ? input.decisions : [];
    return this.macros.importPortablePlugins(
      packages as PortablePluginPackage[] as any,
      decisions as PluginImportDecision[],
    );
  }

  PING_MINECRAFT_SERVER(input: { host?: unknown; port?: unknown }) {
    const host = typeof input?.host === 'string' ? input.host.trim() : '';
    const port = Number(input?.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Invalid server address');
    return getServerStatus(host, port);
  }

  CREATE_CUSTOM_PROFILE(
    input: CreateProfileInput,
    _event?: IpcMainEvent | IpcMainInvokeEvent | null,
    originAddress?: Address,
  ) {
    if (this.accessControl.principal(originAddress).kind !== 'trusted-local')
      throw new Error('Profiles can only be created on this device.');

    const profile = createCustomProfile(input, this.settings.JNdata.serverList, this.macros.toList());
    const profileKey = profile.id;
    this.settings.profiles.upsert(profile);
    this.grantCreatedProfile(originAddress, profileKey);
    return { profileKey, bootstrap: createClientBootstrap(this.settings) };
  }

  DELETE_PROFILE(
    input: { profileKey?: unknown },
    _event?: IpcMainEvent | IpcMainInvokeEvent | null,
    originAddress?: Address,
  ) {
    if (this.accessControl.principal(originAddress).kind !== 'trusted-local')
      throw new Error('Profiles can only be removed on this device.');
    const profileKey =
      typeof input?.profileKey === 'string' ? input.profileKey.trim() : '';
    if (!profileKey) throw new Error('Profile key is required.');

    if (!this.settings.profiles.get(profileKey)) throw new Error('This profile is no longer installed.');
    this.settings.profiles.remove(profileKey);
    return { bootstrap: createClientBootstrap(this.settings) };
  }

  async profileAction(
    profileId: number,
    event: string,
    data?: any,
    originAddress?: Address,
  ): Promise<any> {
    const runtime = this.scriptHandler.getRuntime(profileId);
    this.accessControl.assertProfileAction(originAddress, profileId, event);
    switch (event.toUpperCase()) {
      case 'SCRIPT_PROGRESS': {
        const progress = runtime.activeScripts.getProgress();
        this.publishProfile(runtime, 'PROGRESS_UPDATE', progress);
        return progress;
      }
      case 'STOP':
        if (data && typeof data === 'object' && data.minecraftInstanceId) {
          return this.scriptHandler.minecraftManager.stopMinecraft(
            data.minecraftInstanceId,
            profileId,
          );
        }
        return this.scriptHandler.stop(profileId, data);
      case 'STOP_ALL':
        // By name, or by pluginId (`stopPlugin`, `chain:<id>`).
        if (typeof data === 'string') {
          for (const script of runtime.activeScripts)
            if (script.name === data || script.scriptId === data)
              await script.stop();
          return;
        }
        return this.scriptHandler.stop(profileId, data);
      case 'START_SCRIPT':
        return this.scriptHandler.runScript(profileId, data);
      case 'RESTART_ALL':
        return this.scriptHandler.restartScript(profileId, data);
      case 'SCRIPT_CONTROL': {
        const script = runtime.activeScripts.getScript(data?.instanceId);
        if (!script) return false;
        script.send('SCRIPT_CONTROL', data.control);
        return true;
      }
      case 'GET_LOGS':
        return runtime.consoleHandler.getLogs();
      case 'CLEAR_CONSOLE':
        return runtime.consoleHandler.clear(data);
      case 'OPEN_CONSOLE_LOGS':
        return runtime.consoleHandler.openLogs();
      case 'SERVER_STATUS_UPDATE': {
        const ips = await this.scriptHandler.updateActiveIps(profileId);
        const status = { ips };
        this.publishProfile(runtime, 'SERVER_STATUS', status);
        return status;
      }
      case 'SERVER_STATUS': {
        const status = { ips: runtime.workingIps };
        this.publishProfile(runtime, 'SERVER_STATUS', status);
        return status;
      }
      case 'GET_SCRIPT_ACTIONS':
        return this.scriptHandler.getUiActions(profileId);
      case 'DELETE_MACRO':
        return this.deleteMacro(runtime, data);
      case 'SET_SETTINGS':
      case 'SETTINGS_UPDATE':
        this.settings.updateProfileSettings(runtime.profileKey, data);
        return true;
      case 'SET_APPSETTINGS': {
        if (
          this.accessControl.principal(originAddress).kind === 'remote' &&
          !isProfileSpecificSetting(data?.key)
        )
          this.accessControl.assertGlobalSetting(originAddress);
        const next = this.settings.setAppSetting(
          runtime.profileKey,
          data.key,
          data.value,
        );
        return next;
      }
      case 'APPSETTINGS_UPDATE': {
        const patches = Array.isArray(data) ? data : [data];
        if (
          this.accessControl.principal(originAddress).kind === 'remote' &&
          patches.some((patch) => !isProfileSpecificSetting(patch?.key))
        )
          this.accessControl.assertGlobalSetting(originAddress);
        return this.settings.updateAppSettings(runtime.profileKey, patches);
      }
      case 'ALT_UPDATE':
        this.settings.setAltsForProfile(
          runtime.profileKey,
          data?.alts,
          data?.rename,
        );
        return true;
      case 'ALT_UPSERT':
        return this.upsertAlt(runtime, data);
      case 'ALT_DELETE':
        return this.deleteAlt(runtime, data);
      case 'UPDATE_PLUGIN_DATA': {
        this.settings.updateProfileSettings(runtime.profileKey, {
          path: ['pluginData'],
          value: data,
        });
        return true;
      }
      case 'BOT_ACTION': {
        const bot = runtime.activeBots.getBot(data?.botId);
        if (!bot) return false;
        bot.send('BOT_ACTION', {
          action: data.action,
          data: data.data,
          returnValue: data.returnValue,
        });
        return true;
      }
      case 'LAUNCH_MINECRAFT':
        return this.scriptHandler.minecraftManager.launchMinecraft(data, {
          profileId,
          profileKey: runtime.profileKey,
        });
      case 'MC_LOGOUT_MICROSOFT': {
        const username =
          typeof data?.username === 'string' ? data.username.trim() : '';
        if (!username) throw new TypeError('An alt username is required.');
        const alt = this.settings
          .getAltsWithDataForProfile(runtime.profileKey)
          .find((account) => account.username.toLowerCase() === username.toLowerCase());
        if (!alt) throw new Error('This alt is no longer available.');
        if (!alt.data.premium)
          throw new Error('Only premium accounts can log out of Microsoft.');
        await removeMinecraftAuth(alt.username);
        return true;
      }
      case 'MC_LOGIN_MICROSOFT':
        return this.scriptHandler.minecraftManager.loginMinecraftMicrosoft(
          data?.username ?? data,
          { profileId },
        );
      case 'ALTS_OF_PROFILE': {
        const sourceProfileKey =
          typeof data?.profileKey === 'string'
            ? data.profileKey.trim()
            : runtime.profileKey;
        this.accessControl.assertProfile(originAddress, sourceProfileKey);
        if (!this.settings.JNdata.serverList.includes(sourceProfileKey))
          throw new Error('The requested profile is unavailable.');
        return this.settings.getAltsWithDataForProfile(sourceProfileKey);
      }
      case 'IMPORT_ALTS_FROM_PROFILE':
        return this.importAltsFromProfile(runtime, data, originAddress);
      case 'RESOLVE_PROFILE_SCRIPT_INFO': {
        const scriptId = (data as ProfileScript | undefined)?.id;
        const profileData = this.settings.JNdata.data[runtime.profileKey];
        const script = (profileData?.scripts ?? []).find(
          (candidate) => candidate.id === scriptId,
        );
        if (!script)
          throw new Error('The requested script is not part of this profile.');
        const resolved =
          await this.settings.profiles.scripts?.resolveInfo(script);
        if (resolved?.info)
          return {
            info: {
              ...resolved.info,
              pluginId: resolved.info.pluginId || script.pluginId,
              name: resolved.info.name || script.pluginId,
              description: resolved.info.description ?? '',
            },
          };
        return resolved ?? {
          error: 'Profile script resolver is unavailable',
        };
      }
      case 'RESOLVE_PLUGIN_RUN_DESCRIPTOR': {
        const payload = (data ?? {}) as {
          plugin?: MacroInfo;
          profileScript?: ProfileScript;
          profileScriptId?: string;
        };
        let plugin = payload.plugin;
        let canonicalScript: ProfileScript | undefined;
        const requestedScriptId =
          payload.profileScriptId ?? payload.profileScript?.id;
        if (requestedScriptId) {
          const profileData = this.settings.JNdata.data[runtime.profileKey];
          canonicalScript = (profileData?.scripts ?? []).find(
            (candidate) => candidate.id === requestedScriptId,
          );
          if (!canonicalScript)
            throw new Error('The requested script is not part of this profile.');
          const resolved =
            await this.settings.profiles.scripts?.resolveInfo(canonicalScript);
          if (resolved?.info)
            plugin = {
              ...resolved.info,
              pluginId: resolved.info.pluginId || canonicalScript.pluginId,
              name: resolved.info.name || canonicalScript.pluginId,
              description: resolved.info.description ?? '',
            };
          else
            throw new Error(
              resolved?.error ?? 'This profile automation could not be loaded.',
            );
        }
        if (!plugin?.pluginId) throw new Error('A plugin is required.');
        const profile = this.settings.JNdata.data[runtime.profileKey];
        const settings = this.settings.getProfileSettings(runtime.profileKey);
        const toOptionChoices = (values?: readonly string[]) =>
          (values ?? []).map((value) => ({ label: value, value }));
        const getOptionChoices = (option: PluginOption) => {
          switch (option.type) {
            case 'gamemodeSelect':
              return toOptionChoices(option.gamemodes ?? profile?.gamemodes ?? []);
            case 'altSelect':
            case 'altsSelect':
            case 'altRange':
              return toOptionChoices(Object.keys(settings.altData ?? {}));
            case 'tagsSelect':
              return (settings.altTags ?? []).map(({ name, id }) => ({
                label: name,
                value: id,
              }));
            case 'select':
              return option.options;
            case 'multiSelect':
              return toOptionChoices(option.options);
            default:
              return undefined;
          }
        };
        const mapOption = (option: PluginOption) => {
          return {
            ...option,
            options: getOptionChoices(option),
            supported: option.type !== 'keybind',
            ...(option.type === 'keybind' ? { unsupportedReason: 'Configure keybinds on desktop.' } : {}),
          };
        };
        const values = { ...(settings.scripts?.[plugin.pluginId] ?? {}) } as Record<string, unknown>;
        for (const section of plugin.config ?? []) {
          for (const option of section.options ?? []) {
            if (isSensitivePluginOption(option)) delete values[option.id];
          }
        }
        return {
          info: plugin,
          source: canonicalScript ? 'profile' : 'installed',
          allowed: !isPluginDisallowed(profile, plugin.pluginId),
          blockedReason: isPluginDisallowed(profile, plugin.pluginId) ? 'Disabled by this profile.' : undefined,
          sections: (plugin.config ?? []).map((section) => ({
            id: section.name,
            name: section.name,
            collapsed: section.collapsed,
            options: (section.options ?? []).map(mapOption),
          })),
          values,
        };
      }
      case 'EXPORT_PORTABLE_PROFILE':
        return this.profileTransfer.export(runtime.profileKey);
      default:
        throw new Error(`Unknown profile action: ${event}`);
    }
  }

  private publishProfile(
    runtime: ProfileRuntime,
    event: string,
    data?: unknown,
  ): void {
    backendMessaging.messenger.publishToProfile(runtime.profileId, event, data);
  }

  private upsertAlt(
    runtime: ProfileRuntime,
    input: { alt?: AltWithData; originalUsername?: string },
  ): AltWithData[] {
    const source = input?.alt;
    if (!source || typeof source !== 'object')
      throw new TypeError('An alt is required.');
    const username = source.username?.trim();
    if (!username || !/^[A-Za-z0-9_]{3,16}$/.test(username))
      throw new TypeError('Use a Minecraft username with 3–16 letters, numbers, or underscores.');

    const current = this.settings.getAltsWithDataForProfile(runtime.profileKey);
    const originalUsername = input.originalUsername?.trim();
    const original = originalUsername
      ? current.find((alt) => alt.username.toLowerCase() === originalUsername.toLowerCase())
      : undefined;
    if (originalUsername && !original)
      throw new Error('This alt is no longer available.');
    const duplicate = current.find((alt) => alt.username.toLowerCase() === username.toLowerCase());
    if (duplicate && duplicate !== original)
      throw new Error('This alt already exists in this profile.');

    const premium = source.data?.premium === true;
    // Email is shared identity data. Preserve it when a profile switches the
    // same alt to cracked mode so another profile's premium login survives.
    const password = source.data?.password?.trim();
    const authenticationError = accountAuthenticationError(
      { premium, password },
      isOnlineMode(this.settings.JNdata.data?.[runtime.profileKey]),
    );
    if (authenticationError) throw new TypeError(authenticationError);

    const server = this.settings.JNdata.servers?.[runtime.profileKey] ?? {};
    const availableGamemodes = new Map(
      Object.entries(server).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const ranks: Record<string, string> = {};
    for (const [gamemode, rank] of Object.entries(source.data?.ranks ?? {})) {
      if (!rank) continue;
      const config = availableGamemodes.get(gamemode.toLowerCase());
      const availableRanks = (config as { ranks?: Record<string, unknown> } | undefined)?.ranks ?? {};
      if (!config || !(rank in availableRanks))
        throw new TypeError(`The rank ${rank} is unavailable for ${gamemode}.`);
      ranks[gamemode.toLowerCase()] = rank;
    }
    const gkits: Record<string, string[]> = {};
    for (const [gamemode, names] of Object.entries(source.data?.gkits ?? {})) {
      if (!Array.isArray(names) || names.length === 0) continue;
      const config = availableGamemodes.get(gamemode.toLowerCase());
      const available = (config as { gkits?: Record<string, unknown> } | undefined)?.gkits ?? {};
      if (!config || names.some((name) => typeof name !== 'string' || !(name in available)))
        throw new TypeError(`One or more GKits are unavailable for ${gamemode}.`);
      gkits[gamemode.toLowerCase()] = [...new Set(names)];
    }

    const alt: AltWithData = {
      username,
      UID: original?.UID ?? source.UID,
      data: { premium, password: password || undefined, ranks, gkits },
    };
    const next = original
      ? current.map((candidate) => candidate === original ? alt : candidate)
      : [...current, alt];
    const rename = original && original.username !== username
      ? { from: original.username, to: username }
      : undefined;
    this.settings.setAltsForProfile(runtime.profileKey, next, rename);
    return this.settings.getAltsWithDataForProfile(runtime.profileKey);
  }

  private deleteAlt(
    runtime: ProfileRuntime,
    input: { username?: string },
  ): AltWithData[] {
    const username = input?.username?.trim();
    if (!username) throw new TypeError('An alt username is required.');
    const current = this.settings.getAltsWithDataForProfile(runtime.profileKey);
    const target = current.find((alt) => alt.username.toLowerCase() === username.toLowerCase());
    if (!target) throw new Error('This alt is no longer available.');
    this.settings.setAltsForProfile(
      runtime.profileKey,
      current.filter((alt) => alt !== target),
    );
    const settings = this.settings.getProfileSettings(runtime.profileKey);
    this.settings.updateProfileSettings(runtime.profileKey, {
      path: ['altTags'],
      value: (settings.altTags ?? []).map((tag) => ({
        ...tag,
        alts: tag.alts.filter((entry) => entry.toLowerCase() !== target.username.toLowerCase()),
      })),
    });
    return this.settings.getAltsWithDataForProfile(runtime.profileKey);
  }

  private importAltsFromProfile(
    runtime: ProfileRuntime,
    input: { sourceProfileKey?: string; usernames?: string[] },
    originAddress?: Address,
  ) {
    const sourceProfileKey = input?.sourceProfileKey?.trim();
    if (!sourceProfileKey || sourceProfileKey === runtime.profileKey)
      throw new TypeError('Choose another profile to import from.');
    this.accessControl.assertProfile(originAddress, sourceProfileKey);
    if (!this.settings.JNdata.serverList.includes(sourceProfileKey))
      throw new Error('The source profile is unavailable.');

    const requested = new Set(
      (Array.isArray(input.usernames) ? input.usernames : [])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    if (!requested.size) throw new TypeError('Choose at least one account.');

    const source = this.settings.getAltsWithDataForProfile(sourceProfileKey);
    const onlineMode = isOnlineMode(
      this.settings.JNdata.data?.[runtime.profileKey],
    );
    const current = this.settings.getAltsWithDataForProfile(runtime.profileKey);
    const next = [...current];
    const byUsername = new Map(
      next.map((alt, index) => [alt.username.toLowerCase(), index]),
    );
    const skipped: Array<{ username: string; reason: string }> = [];
    let added = 0;
    let updated = 0;

    for (const alt of source) {
      const key = alt.username.toLowerCase();
      if (!requested.has(key)) continue;
      requested.delete(key);
      const password = alt.data?.password?.trim();

      const authenticationError = accountAuthenticationError(
        { premium: alt.data?.premium, password },
        onlineMode,
      );
      if (authenticationError) {
        skipped.push({ username: alt.username, reason: authenticationError });
        continue;
      }
      const existingIndex = byUsername.get(key);
      const existing = existingIndex === undefined ? undefined : next[existingIndex];
      const imported: AltWithData = {
        ...existing,
        ...alt,
        username: existing?.username ?? alt.username,
        UID: alt.UID ?? existing?.UID,
        data: {
          premium: alt.data?.premium === true,
          password: password || existing?.data?.password,
          ranks: { ...(existing?.data?.ranks ?? {}) },
          gkits: { ...(existing?.data?.gkits ?? {}) },
        },
      };
      if (existingIndex === undefined) {
        byUsername.set(key, next.length);
        next.push(imported);
        added += 1;
      } else {
        next[existingIndex] = imported;
        updated += 1;
      }
    }
    for (const username of requested)
      skipped.push({ username, reason: 'Account is no longer available in the source profile.' });

    if (added || updated) this.settings.setAltsForProfile(runtime.profileKey, next);
    return {
      added,
      updated,
      skipped,
      alts: this.settings.getAltsWithDataForProfile(runtime.profileKey),
    };
  }

  private deleteMacro(runtime: ProfileRuntime, plugin: MacroInfo | string) {
    const pluginId = typeof plugin === 'string' ? plugin : plugin?.pluginId;
    if (!pluginId) throw new TypeError('A plugin id is required.');
    this.macros.delete(pluginId);

    const settings = this.settings.getProfileSettings(runtime.profileKey);
    const pluginData = { ...settings.pluginData };
    delete pluginData[pluginId];
    const scripts = { ...settings.scripts };
    delete scripts[pluginId];
    const pluginMetadata = { ...this.settings.shared.pluginMetadata };
    delete pluginMetadata[pluginId];
    this.settings.updateShared({ pluginMetadata });
    this.settings.updateProfileSettings(runtime.profileKey, [
      { path: ['pluginData'], value: pluginData },
      { path: ['scripts'], value: scripts },
    ]);
    this.macros.send();
    return true;
  }

  private grantCreatedProfile(originAddress: Address | undefined, profileKey: string): void {
    const principal = this.accessControl.principal(originAddress);
    if (principal.kind !== 'remote' || principal.permissions.profiles === '*') return;
    if (principal.permissions.profiles.includes(profileKey)) return;
    const device = this.scriptHandler.deviceHandler.getDevice(principal.subjectId);
    if (!device || device.permissions.profiles === '*') return;
    this.scriptHandler.deviceHandler.updateDevice(device.id, {
      permissions: {
        ...device.permissions,
        profiles: [...device.permissions.profiles, profileKey],
      },
    });
  }

  sendDetails(socket?: Socket) {
    this.settings.sendShared();
    this.settings.sendAppSettings();
    this.settings.sendJNdata();
    this.settings.profiles.send();
    this.settings.stats.send();
    // this.scriptHandler.jnData.send(socket)
    if (!socket) this.scriptHandler.deviceHandler.sendDevices();
    global.send('MACROS', this.macros.toList());
  }

  registerSocket(socket: Socket) {
    if (socket) {
      if (this.registeredSockets.has(socket)) return;
      this.registeredSockets.add(socket);
    }

    /** ipcRenderer.get() */
    socket.on('get', async (event: string, data?: any, cb?: Function) => {
      const result = await this.action(event, data);
      if (cb) cb(result);
    });

    /**
     * ipcRenderer.invoke() — bridged to the `handle` registry (ipcHandle.ts) so
     * remote clients reach the same handlers as Electron's `ipcRenderer.invoke`.
     * The origin gives handlers a working `reply` and `sockets` flag.
     */
    socket.on('invoke', async (event: string, data?: any, cb?: Function) => {
      const result = await invokeHandler(event, socketOrigin(socket), data);
      if (cb) cb(result);
    });

    /**
     * ipcRenderer.send() — bridged to ipcMain using Electron's own calling
     * convention `(event, data)`: the first positional arg is the per-request
     * origin (carrying a working `reply`), the payload is second. Matching the
     * order is what lets every existing `ipcMain.on` handler — both the
     * `e.reply(...)` getters and the `(origin, data)` writers — serve remote
     * clients without any per-handler changes.
     */
    socket.on('send', (event: string, data?: any) => {
      ipcMain.emit(event, socketOrigin(socket), data);
    });

    /** ipcRenderer.action() */
    socket.on('action', (event: string, data?: any) => {
      this.action(event, data);
    });
  }

  unregisterSocket(socket: Socket) {
    if (this.registeredSockets.has(socket)) {
      this.registeredSockets.delete(socket);
    }
  }

  events() {
    // NOTE: the `actions` and `invoke` channels are registered at main-process
    // module load (src/index.ts) and forwarded to `this.action` once this
    // instance is built. This avoids a "No handler registered for 'invoke'"
    // error when the renderer fires its first `get()`/`action()` call before
    // ClientEvents is constructed.
    ipcMain.handle('GUEST_VIEW_MANAGER_CALL', () => ({})); // idk why but sometimes this gets called (webview thingy ig)
  }

  private profileIdRequired(): never {
    throw new Error('profileId is required for this action');
  }

  SCRIPT_PROGRESS() {
    return this.profileIdRequired();
  }

  STOP(instanceId: number | { minecraftInstanceId: string }) {
    return this.profileIdRequired();
  }

  STOP_ALL(target: number | string) {
    return this.profileIdRequired();
  }

  async GET_UUID(username: string) {
    return await uuid(username);
  }

  async START_SCRIPT(
    scriptData: ScriptDataType & { scriptOptions?: ScriptOptions },
  ) {
    return this.profileIdRequired();
  }

  PING([event, data]: [string, any], e?: IpcMainEvent | null) {
    if (typeof e?.reply === 'function') e.reply(event, data);
    else global.send(event, data);
  }

  EXIT_APP() {
    app.quit();
  }

  RESTART_ALL(instanceId: number) {
    return this.profileIdRequired();
  }

  SCRIPT_CONTROL() {
    return this.profileIdRequired();
  }

  async SELECT_DIRECTORY(options = {}) {
    return await getPlatform().selectDirectory(options);
  }

  // logging directory
  OPEN_CONSOLE_LOGS() {
    return this.profileIdRequired();
  }

  GET_JNDATA() {
    return this.settings.JNdata;
  }

  REMOVE_DEVICE(data: Pick<Device, 'id'>) {
    if (!data?.id) return;
    this.scriptHandler.deviceHandler.removeDevice(data.id);
  }

  CREATE_DEVICE({
    name,
    permissions,
  }: {
    name: string;
    permissions?: unknown;
  }) {
    const normalizedName = name?.trim().slice(0, 25);
    if (!normalizedName) return;
    const normalized = normalizePermissions(permissions);
    if (normalized.profiles !== '*' && normalized.profiles.length === 0)
      throw new Error('Choose at least one profile for this access link.');
    return this.scriptHandler.deviceHandler.createDevice(normalizedName, normalized);
  }

  UPDATE_DEVICE(data: Pick<Device, 'id' | 'name'>) {
    if (!data?.name) return;
    this.scriptHandler.deviceHandler.updateDevice(data.id, {
      name: data.name,
    });
  }

  UPDATE_DEVICE_PERMISSIONS(data: Pick<Device, 'id' | 'permissions'>) {
    if (!data?.id) return;
    this.scriptHandler.deviceHandler.updateDevice(data.id, {
      permissions: normalizePermissions(data.permissions),
    });
  }

  CLOSE_CONNECTION(data: Pick<Device, 'id'>) {
    if (!data?.id) return;
    this.scriptHandler.deviceHandler.closeConnection(data.id);
  }

  async TURN_ON_SERVER({ server }: { server: ServerTypes }) {
    return this.scriptHandler.deviceHandler.start(server);
  }

  async TURN_OFF_SERVER({ server }: { server: ServerTypes }) {
    await this.scriptHandler.deviceHandler.stop(server);
  }

  async BUTTON_POPUP(data: {
    title: string;
    buttons: { label: string; id: string }[];
    body: string;
  }) {
    const id = Math.random();
    return new Promise((resolve) => {
      global.send('popup-buttons', { ...data, isMain: true, popupID: id });
      ipcMain.on('popup-buttons', handler);

      function handler(_: any, data: { targetId: number; response: string }) {
        if (data.targetId === id) {
          ipcMain.removeListener('popup-buttons', handler);
          resolve(data.response);
        }
      }
    });
  }

  ERROR(err: { error: string; stack: string }) {
    this.scriptHandler.errorHandler.handle({
      message: err.error,
      stack: err.stack,
      script: 'JNbot interface (UI)',
    });
  }

  ALT_CREATED(alt: Alt) {
    this.settings.stats.addAccount(alt.username, true);
  }

  async GET_LOGS() {
    return this.profileIdRequired();
  }

  CLEAR_CONSOLE(scriptName: string | undefined) {
    return this.profileIdRequired();
  }

  async SERVER_STATUS_UPDATE(
    opt: { server?: string } | undefined = {},
  ): Promise<{ ips: string[] }> {
    return this.profileIdRequired();
  }

  async SERVER_STATUS(_: undefined, e: any): Promise<{ ips: string[] }> {
    return this.profileIdRequired();
  }

  async JN_FETCH(options: { url: string; json?: boolean }) {
    return jnFetch(options);
  }

  // --------------- MACRO EVENTS --------------- \\
  GET_SCRIPT_ACTIONS() {
    return this.profileIdRequired();
  }

  CREATE_MACRO(data: {
    name: string;
    description: string;
    language: MacroLanguage;
    scriptType: MacroScriptType;
    folder?: string;
  }) {
    return this.macros.create(data);
  }
  MACRO_CODE(pluginId: string) {
    return this.macros.getMacro(pluginId);
  }

  SAVE_MACRO_INFO(macroInfo: MacroInfo) {
    return this.macros.saveInfo(macroInfo);
  }

  DELETE_MACRO(plugin: MacroInfo | string) {
    throw new Error('profileId is required for DELETE_MACRO');
  }

  DUPLICATE_MACRO(pluginId: string) {
    return this.macros.duplicate(pluginId);
  }

  UPDATE_PLUGIN_DATA(pluginData: PluginData) {
    return this.profileIdRequired();
  }

  SAVE_MACRO({ pluginId, code }: { pluginId: string; code: MacroCode }) {
    return this.macros.save(pluginId, code);
  }

  MIGRATE_MACRO_TO_RECIPE({
    pluginId,
    recipe,
  }: {
    pluginId: string;
    recipe: RecipeDocumentV3;
  }) {
    return this.macros.migrateComponentsToRecipe(pluginId, recipe);
  }

  GET_MACROS(_: any, e: any) {
    let list = this.macros.toList();
    if (typeof e?.reply === 'function') e.reply('MACROS', list);
    else global.send('MACROS', list);
    return list;
  }

  async EXPORT_MACRO({ macroInfo, code }: { macroInfo: MacroInfo; code: MacroCode }) {
    return this.macros.export(macroInfo, code);
  }

  GET_PUBLISHER_IDENTITY() {
    try {
      return { status: 'success' as const, ...pluginSecurity().getIdentitySummary() };
    } catch (error: any) {
      return { status: 'error' as const, message: error?.message ?? 'Publisher identity is unavailable' };
    }
  }

  SET_PUBLISHER_NAME(name: string) {
    try {
      return { status: 'success' as const, ...pluginSecurity().setPublisherName(name) };
    } catch (error: any) {
      return { status: 'error' as const, message: error?.message ?? 'Failed to save publisher name' };
    }
  }

  GET_TRUSTED_PUBLISHERS() {
    return pluginSecurity().listTrustedPublishers();
  }

  REMOVE_TRUSTED_PUBLISHER(fingerprint: string) {
    pluginSecurity().removeTrustedPublisher(fingerprint);
    this.macros.invalidateLocalCache();
    this.macros.send();
    return { status: 'success' as const };
  }

  private async shareResult<T>(run: () => Promise<T>) {
    try {
      return { status: 'success' as const, data: await run() };
    } catch (error: any) {
      if (error?.message === 'PUBLISHER_NAME_REQUIRED') {
        return {
          status: 'publisher-name-required' as const,
          identity: pluginSecurity().getIdentitySummary(),
        };
      }
      return { status: 'error' as const, message: error?.message ?? 'Share link request failed' };
    }
  }

  SHARE_STATE() {
    return this.shares.state();
  }

  /** All shares (throttled), or one installed share right away. */
  SHARE_CHECK_UPDATES(id?: string) {
    return this.shareResult(() =>
      typeof id === 'string' ? this.shares.checkShare(id) : this.shares.checkUpdates(true),
    );
  }

  SHARE_CREATE(input: ShareCreateInput) {
    return this.shareResult(() => this.shares.create(input));
  }

  SHARE_HAS_CHANGES(id: string) {
    return this.shareResult(() => this.shares.hasChanges(id));
  }

  SHARE_UPDATE(id: string) {
    return this.shareResult(() => this.shares.update(id));
  }

  SHARE_VISIBILITY(input: ShareVisibilityInput) {
    return this.shareResult(() => this.shares.setVisibility(input?.id, input?.visibility, input?.servers));
  }

  SHARE_DELETE(id: string) {
    return this.shareResult(() => this.shares.remove(id));
  }

  SHARE_PREVIEW(input: SharePreviewInput | string) {
    return this.shareResult(() => this.shares.preview(input));
  }

  SHARE_MARKET(force?: boolean) {
    return this.shareResult(() => this.shares.marketplace(force === true));
  }

  SHARE_REPORT(input: { id: string; reason: string }) {
    return this.shareResult(() => this.shares.report(input?.id, input?.reason));
  }

  SHARE_REVIEW_QUEUE() {
    return this.shareResult(() => this.shares.reviewQueue());
  }

  SHARE_REVIEW(input: ShareReviewInput) {
    return this.shareResult(() => this.shares.review(input));
  }

  SHARE_INSTALL(
    input: ShareInstallInput,
    _event?: IpcMainEvent | IpcMainInvokeEvent | null,
    originAddress?: Address,
  ) {
    return this.shareResult(() =>
      this.shares.install(input, (kind) => {
        if (kind === 'profile' && !this.accessControl.hasPermission(originAddress, MANAGE_PROFILES)) {
          throw new Error('This device is not allowed to install profiles.');
        }
        if ((kind === 'chain' || kind === 'trigger') && input.profileKey) {
          this.accessControl.assertProfile(originAddress, input.profileKey);
        }
      }),
    );
  }

  async IMPORT_MACRO() {
    return this.macros.import();
  }

  async IMPORT_MACRO_FILE(input: string | { content?: unknown }) {
    if (typeof input === 'object' && typeof input?.content === 'string')
      return this.macros.importFromContent(input.content);
    return this.macros.importFile(input as string);
  }

  async OPEN_PLUGIN_EXTERNAL(pluginId: string) {
    return this.macros.openInExternalEditor(
      pluginId,
      this.settings.sharedAppSettings.pluginEditorCommand,
    );
  }

  async START_PEER_TO_PEER() {
    await this.scriptHandler.webRTCHandler.connect();
  }

  async STOP_PEER_TO_PEER() {
    await this.scriptHandler.webRTCHandler.stop();
  }

  async EXPORT_SETTINGS() {
    return this.scriptHandler.getCloudStorage().exportToFile();
  }

  async IMPORT_SETTINGS(input?: { fileContent?: unknown; password?: unknown }) {
    const storage = this.scriptHandler.getCloudStorage();
    try {
      if (typeof input?.fileContent === 'string') {
        if (typeof input.password === 'string' && input.password.length > 0)
          await storage.importData(input.fileContent, input.password);
        else await storage.importDirectTransferArchive(input.fileContent);
        return { success: true };
      }
      return { success: await storage.importFromFile() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  REQUEST_INSTANCE_TRANSFER(input: { requestId?: unknown }, _event?: unknown, origin?: Address) {
    if (origin === undefined) throw new Error('Instance transfer is only available to paired devices.');
    const principal = this.accessControl.principal(origin);
    if (principal.kind !== 'remote') throw new Error('Instance transfer is only available to paired devices.');
    return this.instanceTransfer.request(this.scriptHandler.getCloudStorage(), origin, principal.subjectId, input?.requestId);
  }
  READ_INSTANCE_TRANSFER_CHUNK(input: { transferId?: unknown; index?: unknown }, _event?: unknown, origin?: Address) {
    if (origin === undefined) throw new Error('Instance transfer is only available to paired devices.');
    return this.instanceTransfer.read(origin, input?.transferId, input?.index);
  }
  COMPLETE_INSTANCE_TRANSFER(input: { transferId?: unknown }, _event?: unknown, origin?: Address) {
    if (origin === undefined) throw new Error('Instance transfer is only available to paired devices.');
    return this.instanceTransfer.complete(origin, input?.transferId);
  }
  CANCEL_INSTANCE_TRANSFER(input: { transferId?: unknown }, _event?: unknown, origin?: Address) {
    if (origin === undefined) throw new Error('Instance transfer is only available to paired devices.');
    return this.instanceTransfer.cancel(origin, input?.transferId);
  }

  MOBILE_INSTANCE_TRANSFER_BEGIN(input: InstanceTransferManifest, _event?: unknown, origin?: Address) {
    this.assertMobileTransferReceiver(origin);
    return this.mobileInstanceTransfer.begin(input);
  }
  MOBILE_INSTANCE_TRANSFER_APPEND(input: InstanceTransferChunk, _event?: unknown, origin?: Address) {
    this.assertMobileTransferReceiver(origin);
    return this.mobileInstanceTransfer.append(input);
  }
  async MOBILE_INSTANCE_TRANSFER_FINISH(_input?: unknown, _event?: unknown, origin?: Address) {
    this.assertMobileTransferReceiver(origin);
    return this.mobileInstanceTransfer.finish(this.scriptHandler.getCloudStorage());
  }
  MOBILE_INSTANCE_TRANSFER_CANCEL(_input?: unknown, _event?: unknown, origin?: Address) {
    this.assertMobileTransferReceiver(origin);
    return this.mobileInstanceTransfer.cancel();
  }

  private assertMobileTransferReceiver(origin?: Address): void {
    if (process.env.JNBOT_MOBILE_RUNTIME !== 'true' || origin === undefined)
      throw new Error('This transfer receiver is only available in JNbot Mobile.');
    const principal = this.accessControl.principal(origin);
    if (principal.kind !== 'trusted-local' || principal.subjectId !== 'mobile')
      throw new Error('This transfer receiver is only available to JNbot Mobile.');
  }

  async GET_RECORDINGS() {
    const recordings = await this.scriptHandler.recordings.getRecordings();
    global.send('RECORDINGS', recordings);
  }

  DELETE_RECORDING(id: string) {
    this.scriptHandler.recordings.removeRecording(id);
  }
  RENAME_RECORDING(update: { id: string; name: string }) {
    this.scriptHandler.recordings.updateName(update.id, update.name);
  }

  GET_RECORDING_DATA(id: string) {
    return this.scriptHandler.recordings.getRecordingData(id);
  }

  UPDATE_RECORDING_NAME(o: { id: string; name: string }) {
    this.scriptHandler.recordings.updateName(o.id, o.name);
  }

  UPDATE_RECORDING_DATA(o: { id: string; packets: string }) {
    this.scriptHandler.recordings.updateRecordingData(o.id, o.packets);
  }

  START_AUTOMATION_RECORDING(o: {
    clientId: string;
    pluginId?: string;
    name?: string;
  }) {
    return this.scriptHandler.automationService.startRecording(
      o.clientId,
      o.pluginId,
      o.name,
    );
  }

  USE_AUTOMATION_TAKE(o: { pluginId: string; file: string }) {
    return this.scriptHandler.automationService.useTake(o.pluginId, o.file);
  }

  START_BRAIN_PRACTICE(o: { clientId: string; pluginId: string }) {
    return this.scriptHandler.automationService.startPractice(
      o.clientId,
      o.pluginId,
    );
  }

  GET_BRAIN_INFO(o: { pluginId: string; learn?: BrainLearnSettings }) {
    return this.scriptHandler.automationService.brains.info(
      o.pluginId,
      o.learn,
    );
  }

  GET_BRAIN_MODEL(o: { pluginId: string }) {
    return this.scriptHandler.automationService.brains.model(o.pluginId);
  }

  DELETE_BRAIN_EXAMPLE(o: { pluginId: string; file: string }) {
    this.scriptHandler.automationService.brains.deleteExample(
      o.pluginId,
      o.file,
    );
  }

  async START_AUTOMATION_REPLAY(o: {
    automationId: string;
    target: AutomationTargetDescriptor;
    options: AutomationReplayOptions;
  }) {
    if (o.target.kind === 'minecraft') {
      return this.scriptHandler.automationService.startClientReplay(
        String(o.target.id),
        o.automationId,
        o.options,
      );
    }
    if (typeof o.target.profileId !== 'number')
      throw new Error('profileId is required for a bot replay');
    const bot = this.scriptHandler
      .getRuntime(o.target.profileId)
      .activeBots.getBot(Number(o.target.id));
    if (!bot) throw new Error('Bot is no longer connected');
    const document = await this.scriptHandler.automationService.get(
      o.automationId,
    );
    return bot.runAction(
      'runAutomation',
      { document, options: o.options },
      new EventEmitter(),
    );
  }

  async AUTOMATION_SESSION_CONTROL(o: {
    sessionId: string;
    action: 'pause' | 'resume' | 'stop';
    target: AutomationTargetDescriptor;
  }) {
    if (o.target.kind === 'minecraft')
      return this.scriptHandler.automationService.controlSession(
        o.sessionId,
        o.action,
      );
    if (typeof o.target.profileId !== 'number')
      throw new Error('profileId is required for a bot replay');
    const bot = this.scriptHandler
      .getRuntime(o.target.profileId)
      .activeBots.getBot(Number(o.target.id));
    if (!bot) throw new Error('Bot is no longer connected');
    return bot.runAction(
      'controlAutomation',
      { sessionId: o.sessionId, action: o.action },
      new EventEmitter(),
    );
  }

  GET_AUTOMATION_SESSIONS() {
    return this.scriptHandler.automationService.sessionStatuses();
  }

  SET_SETTINGS(o: { settings: SettingsObj; updateClient?: boolean }) {
    return this.profileIdRequired();
  }

  SET_APPSETTINGS(o: { appSettings: AppSettings; updateClient?: boolean }) {
    return this.profileIdRequired();
  }

  SET_DEFAULT_PROFILE(profileKey: string) {
    return this.settings.setDefaultProfile(profileKey);
  }

  OPEN_URL(url: string) {
    this.windowHandler.openExternal(url, { target: 'browser' });
  }

  BOT_ACTION(data: {
    botId: number;
    action: string;
    data?: any;
    returnValue?: number;
  }) {
    return this.profileIdRequired();
  }

  async LAUNCH_MINECRAFT(options: LaunchMinecraftOptions) {
    return this.profileIdRequired();
  }

  GET_MINECRAFT_VERSIONS() {
    return this.scriptHandler.minecraftManager.getMinecraftVersions();
  }

  GET_MC_LAUNCH_LOGS(bridgeInstanceId: string) {
    return this.scriptHandler.minecraftManager.getLaunchLogs(bridgeInstanceId);
  }

  CLEAR_MC_LAUNCH_LOGS(bridgeInstanceId: string) {
    return this.scriptHandler.minecraftManager.clearLaunchLogs(bridgeInstanceId);
  }

  LAUNCHER_MODS(mcVersion: string) {
    const mods =
      this.scriptHandler.minecraftManager.listMinecraftMods(mcVersion);
    global.send('LAUNCHER_MODS', mods);
  }

  ADD_MINECRAFT_MOD(params: {
    modId: string;
    type: 'mod' | 'modpack';
    version: string;
    isProject: boolean;
    loader: string;
  }) {
    return this.scriptHandler.minecraftManager.addMinecraftMods(params);
  }

  REMOVE_MINECRAFT_MOD(params: {
    modId: string;
    type: 'mod' | 'modpack';
    version: string;
    isProject: boolean;
    loader: string;
  }) {
    return this.scriptHandler.minecraftManager.removeMinecraftMod(params);
  }

  GET_FEATURED_MINECRAFT_MODS(version: string) {
    return this.scriptHandler.minecraftManager.getFeaturedMods(version);
  }

  GET_MOD_PROJECT(projectId: string) {
    return this.scriptHandler.minecraftManager.getModProject(projectId);
  }

  MC_BRIDGE_LIST_CLIENTS() {
    const server = getMcBridgeServer();
    return server ? server.listClients() : [];
  }

  MC_BRIDGE_BROADCAST_COMMAND(params: { name: string; params?: unknown }) {
    const server = getMcBridgeServer();
    if (!server) return { ok: false, sent: 0 };
    const sent = server.broadcastCommand(params.name, params.params);
    return { ok: true, sent };
  }

  MC_BRIDGE_SEND_COMMAND(params: {
    clientId: string;
    name: string;
    params?: unknown;
  }) {
    const server = getMcBridgeServer();
    if (!server) return { ok: false };
    const ok = server.sendCommand(params.clientId, params.name, params.params);
    return { ok };
  }

  MC_LOGIN_MICROSOFT(username?: string) {
    return this.profileIdRequired();
  }

  SEARCH_MINECRAFT_MODS(searchOptions: SearchProjectOptions) {
    return this.scriptHandler.minecraftManager.searchMod(searchOptions);
  }

  async MC_SERVERS_LIST() {
    await this.scriptHandler.minecraftServerManager.activate();
    return this.scriptHandler.minecraftServerManager.list();
  }

  async MC_SERVER_GET({ id }: { id: string }) {
    await this.scriptHandler.minecraftServerManager.activate();
    return this.scriptHandler.minecraftServerManager.detail(id);
  }

  MC_SERVER_WORLDS(root?: string) {
    return this.scriptHandler.minecraftServerManager.discoverWorlds(root);
  }

  MC_SERVER_BRIDGE_CLIENTS() {
    return this.scriptHandler.minecraftServerManager.bridgeClients();
  }

  MC_SERVER_CREATE(input: CreateMinecraftServerInput) {
    return this.scriptHandler.minecraftServerManager.createDedicated(input);
  }

  MC_SERVER_SHARE_CLIENT(input: ShareMinecraftClientWorldInput) {
    return this.scriptHandler.minecraftServerManager.shareClientWorld(input);
  }

  MC_SERVER_SHARE_LAN(input: ShareMinecraftLanInput) {
    return this.scriptHandler.minecraftServerManager.shareManualLan(input);
  }

  MC_SERVER_IMPORT_INVITE(invite: string) {
    return this.scriptHandler.minecraftServerManager.importInvite(invite);
  }

  MC_SERVER_START({ id }: { id: string }) {
    return this.scriptHandler.minecraftServerManager.start(id);
  }

  MC_SERVER_STOP({ id }: { id: string }) {
    return this.scriptHandler.minecraftServerManager.stop(id);
  }

  MC_SERVER_REMOVE({
    id,
    deleteFiles = false,
  }: {
    id: string;
    deleteFiles?: boolean;
  }) {
    return this.scriptHandler.minecraftServerManager.remove(id, deleteFiles);
  }

  MC_SERVER_INVITE({ id }: { id: string }) {
    return this.scriptHandler.minecraftServerManager.invite(id);
  }

  MC_SERVER_ROTATE_INVITE({ id }: { id: string }) {
    return this.scriptHandler.minecraftServerManager.rotateInvite(id);
  }

  MC_SERVER_CONSOLE_LINES({ id }: { id: string }) {
    return this.scriptHandler.minecraftServerManager.consoleLines(id);
  }

  MC_SERVER_CONSOLE_COMMAND({ id, command }: { id: string; command: string }) {
    return this.scriptHandler.minecraftServerManager.consoleCommand(
      id,
      command,
    );
  }

  MC_SERVER_PLUGINS_LIST({ id }: { id: string }) {
    return this.scriptHandler.minecraftServerManager.plugins(id);
  }

  MC_SERVER_PLUGINS_SEARCH({
    id,
    query,
    offset,
    limit,
  }: {
    id: string;
    query?: string;
    offset?: number;
    limit?: number;
  }) {
    return this.scriptHandler.minecraftServerManager.searchPlugins(
      id,
      query,
      offset,
      limit,
    );
  }

  MC_SERVER_PLUGIN_PROJECT({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }) {
    return this.scriptHandler.minecraftServerManager.pluginProject(
      id,
      projectId,
    );
  }

  MC_SERVER_PLUGIN_INSTALL({
    id,
    projectId,
    versionId,
  }: {
    id: string;
    projectId: string;
    versionId?: string;
  }) {
    return this.scriptHandler.minecraftServerManager.installPlugin(
      id,
      projectId,
      versionId,
    );
  }

  MC_SERVER_PLUGIN_REMOVE({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }) {
    return this.scriptHandler.minecraftServerManager.removePlugin(
      id,
      projectId,
    );
  }

  MC_SERVER_RESTART({ id }: { id: string }) {
    return this.scriptHandler.minecraftServerManager.restart(id);
  }

  async CLOUD_STORAGE_INFO() {
    const cloudStorage = this.scriptHandler.getCloudStorage();
    let hasStorage = false;

    try {
      hasStorage = await cloudStorage.hasCloudData();
    } catch (err) {
      console.error(err);
      return {
        used: false,
        userId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      used: hasStorage,
      userId: cloudStorage.getUserId(),
      error: null,
    };
  }

  async CLOUD_STORAGE_UPLOAD(options?: { shareKey?: string | string[] }) {
    const cloudStorage = this.scriptHandler.getCloudStorage();
    try {
      return { status: 'success' as const, ...(await cloudStorage.upload(options)) };
    } catch (error) {
      if (error instanceof Error && error.message === 'PUBLISHER_NAME_REQUIRED') {
        return {
          status: 'publisher-name-required' as const,
          identity: pluginSecurity().getIdentitySummary(),
        };
      }
      return {
        status: 'error' as const,
        message: error instanceof Error ? error.message : 'Failed to save data to cloud.',
      };
    }
  }

  CLOUD_STORAGE_GENERATE_KEY() {
    // Wrapped in a Promise to match the IPC contract (renderer awaits results).
    return Promise.resolve({ shareKey: CloudStorage.generateShareKey() });
  }

  async CLOUD_STORAGE_IMPORT({
    userId,
    password,
  }: {
    userId: string;
    password: string | string[];
  }): Promise<{ success: boolean; error?: string }> {
    const cloudStorage = this.scriptHandler.getCloudStorage();
    try {
      await cloudStorage.importSharedFromUser({
        userId,
        shareKey: password,
      });

      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Failed to import from cloud storage:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  CLOUD_STORAGE_REMOVE() {
    const cloudStorage = this.scriptHandler.getCloudStorage();
    return cloudStorage.deleteCloudData();
  }

  ALTS_OF_PROFILE({ profileKey }: { profileKey: string }) {
    return this.scriptHandler.settings.getAltsWithDataForProfile(profileKey);
  }
}

export default ClientEvents_;
