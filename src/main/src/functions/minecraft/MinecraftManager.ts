import type {
  LaunchMinecraftOptions,
  ModInfo,
  ModList,
  ModpackInfo,
  MinecraftLaunchLogSnapshot,
} from '../../types';
import MinecraftLauncher from './MinecraftLauncher';
import MinecraftAccountService, {
  type LaunchSessionResult,
} from './MinecraftAccountService';
import type Settings_ from '../Settings';
import type MinecraftInstances from './MinecraftInstances';
import { isMinecraftLaunchStatusPayload } from './MinecraftInstances';
import type MinecraftSessions from './MinecraftSessions';
import type JnbotMcBridgeServer from './bridge/JnbotMcBridgeServer';
import { randomUUID } from 'crypto';
import { VersionInfo } from './launcher/MinecraftLauncherTypes';
import Modrinth from './launcher/Modrinth';
import { SearchProjectOptions } from '@xmcl/modrinth';
import { backendMessaging } from '../../messaging';
import { MinecraftLauncherTypes } from '../../../../common/CommonEnums';
import { offlineUuid } from './minecraftPaths';

class MinecraftManager {
  private settings: Settings_;
  private minecraftInstances: MinecraftInstances;
  private ensureMcBridgeServer: () => JnbotMcBridgeServer;
  private scheduleMcBridgeIdleStop: () => void;
  private minecraftLauncher: MinecraftLauncher;
  private minecraftAccounts: MinecraftAccountService;
  private readonly profileByInstance = new Map<string, number>();
  private readonly cancelledInstances = new Set<string>();

  private static readonly FEATURED_MODS = [
    { projectId: 'BYfVnHa7', isModPack: true, name: 'Simply Optimized' },
  ];

  constructor(
    settings: Settings_,
    minecraftInstances: MinecraftInstances,
    _minecraftSessions: MinecraftSessions,
    ensureMcBridgeServer: () => JnbotMcBridgeServer,
    scheduleMcBridgeIdleStop: () => void,
  ) {
    this.settings = settings;
    this.minecraftInstances = minecraftInstances;
    this.ensureMcBridgeServer = ensureMcBridgeServer;
    this.scheduleMcBridgeIdleStop = scheduleMcBridgeIdleStop;

    this.minecraftLauncher = new MinecraftLauncher((event, data) => {
      const instanceId =
        data && typeof data === 'object' && 'bridgeInstanceId' in data
          ? String((data as { bridgeInstanceId: unknown }).bridgeInstanceId)
          : undefined;
      const profileId = instanceId
        ? this.profileByInstance.get(instanceId)
        : undefined;
      if (profileId)
        backendMessaging.messenger.publishToProfile(profileId, event, data);
      else global.send(event, data);

      if (
        event === 'MC_LAUNCH_STATUS' &&
        isMinecraftLaunchStatusPayload(data)
      ) {
        this.minecraftInstances.updateFromLaunchStatus(data);
        if (data.stage === 'exit' || data.stage === 'error') {
          if (data.stage === 'exit' && data.code === 0)
            this.profileByInstance.delete(data.bridgeInstanceId);
          this.scheduleMcBridgeIdleStop();
        }
      }
      if (event === 'MC_LAUNCH_CRASH_INFO' && instanceId) {
        this.profileByInstance.delete(instanceId);
      }
    });

    this.minecraftAccounts = new MinecraftAccountService();
  }

  async launchMinecraft(
    options?: LaunchMinecraftOptions,
    profile?: { profileId: number; profileKey: string },
  ) {
    const launchOptions: LaunchMinecraftOptions = {
      ...(this.settings.shared.launcherOptions ?? {
        gamemode: null,
        username: '',
        version: '1.21.11',
      }),
      ...options,
    };
    if (!launchOptions.version || !launchOptions.username) {
      throw new Error(
        'Minecraft version and username must be specified to launch Minecraft',
      );
    }

    const bridgeInstanceId = launchOptions.bridgeInstanceId ?? randomUUID();
    if (profile)
      this.profileByInstance.set(bridgeInstanceId, profile.profileId);
    this.ensureMcBridgeServer();
    this.minecraftInstances.create({
      instanceId: bridgeInstanceId,
      username: launchOptions.username,
      requestedVersion: launchOptions.version,
    });

    const profileKey = profile?.profileKey ?? this.settings.bootstrapProfileKey;
    const alts = this.settings.getAltsWithDataForProfile(profileKey);
    const alt = alts.find((a) => a.username === launchOptions.username);
    const sendEvent = profile
      ? (event: string, data?: unknown) =>
          backendMessaging.messenger.publishToProfile(
            profile.profileId,
            event,
            data,
          )
      : (event: string, data?: unknown) => global.send(event, data);

    let session: LaunchSessionResult | null = null;
    try {
      // Only premium accounts have a Microsoft session; cracked/offline alts
      // launch with an offline UUID. getLaunchSessionForAlt reuses the shared
      // prismarine-auth cache and prompts for device-code login on demand.
      if (alt?.data.premium) {
        session = await this.minecraftAccounts.getLaunchSessionForAlt(
          alt,
          sendEvent,
        );
      }

      const result = await this.minecraftLauncher.launchMinecraft(
        { ...launchOptions, bridgeInstanceId },
        profile
          ? this.settings.getProfileAppSettings(profile.profileKey)
          : this.settings.getProfileAppSettings(
              this.settings.bootstrapProfileKey,
            ),
        session?.session ?? undefined,
        launchOptions.launcherFlags === MinecraftLauncherTypes.LUNAR
          ? {
              // Every profile alt shows up in Lunar's account switcher
              accounts: alts.map((a) => ({
                name: a.username,
                uuid: (a.data.premium && a.UID) || offlineUuid(a.username),
                premium: !!a.data.premium,
              })),
              getSession: async (name) =>
                (await this.minecraftAccounts.getSession(name, sendEvent))
                  .session,
            }
          : undefined,
      );

      if (this.cancelledInstances.delete(bridgeInstanceId)) {
        await this.minecraftLauncher.stopMinecraft(bridgeInstanceId);
        this.minecraftInstances.stop(bridgeInstanceId);
        this.profileByInstance.delete(bridgeInstanceId);
        this.scheduleMcBridgeIdleStop();
        return result;
      }

      this.minecraftInstances.setMinecraftRoot(
        bridgeInstanceId,
        result.minecraftRoot,
      );
      this.scheduleMcBridgeIdleStop();
      return result;
    } catch (err) {
      this.cancelledInstances.delete(bridgeInstanceId);
      this.profileByInstance.delete(bridgeInstanceId);
      this.minecraftInstances.failed(bridgeInstanceId);
      throw err;
    }
  }

  profileIdForInstance(instanceId: string): number | undefined {
    return this.profileByInstance.get(instanceId);
  }

  async stopMinecraft(instanceId: string, profileId: number): Promise<boolean> {
    if (this.profileByInstance.get(instanceId) !== profileId) return false;
    this.cancelledInstances.add(instanceId);
    const stopped = await this.minecraftLauncher.stopMinecraft(instanceId);
    this.minecraftInstances.stop(instanceId);
    this.profileByInstance.delete(instanceId);
    this.scheduleMcBridgeIdleStop();
    if (stopped) this.cancelledInstances.delete(instanceId);
    return true;
  }

  async loginMinecraftMicrosoft(
    username?: string,
    profile?: { profileId: number },
  ) {
    return await this.minecraftAccounts.loginWithMicrosoftDeviceCode(
      this.settings,
      username,
      profile
        ? (event, data) =>
            backendMessaging.messenger.publishToProfile(
              profile.profileId,
              event,
              data,
            )
        : (event, data) => global.send(event, data),
    );
  }

  async getMinecraftVersions(): Promise<VersionInfo[]> {
    return await this.minecraftLauncher.getMinecraftVersions({ limit: 30 });
  }

  getLaunchLogs(bridgeInstanceId: string): MinecraftLaunchLogSnapshot {
    return this.minecraftLauncher.getRecentLogs(bridgeInstanceId);
  }

  clearLaunchLogs(bridgeInstanceId: string): boolean {
    return this.minecraftLauncher.clearRecentLogs(bridgeInstanceId);
  }

  listMinecraftMods(minecraftVersion: string): ModList {
    return this.minecraftLauncher.modHandler.getModList(minecraftVersion);
  }

  async addMinecraftMods(params: {
    modId: string;
    type: 'mod' | 'modpack';
    version: string;
    isProject: boolean;
    loader: string;
  }): Promise<void> {
    if (params.type === 'modpack') {
      if (params.isProject) {
        return this.minecraftLauncher.modHandler.addModPackByProjectId(
          params.modId,
          params.version,
          params.loader,
        );
      }
      return this.minecraftLauncher.modHandler.addModPackById(
        params.modId,
        params.version,
      );
    } else {
      if (params.isProject) {
        return this.minecraftLauncher.modHandler.addModByProjectId(
          params.modId,
          params.version,
          params.loader,
        );
      }
      return this.minecraftLauncher.modHandler.addModById(
        params.modId,
        params.version,
      );
    }
  }

  async removeMinecraftMod(params: {
    modId: string;
    type: 'mod' | 'modpack';
    version: string;
    isProject: boolean;
    loader: string;
  }): Promise<void> {
    if (params.type === 'modpack') {
      if (params.isProject) {
        return this.minecraftLauncher.modHandler.removeModPackByProjectId(
          params.modId,
          params.version,
          params.loader,
        );
      }
      return this.minecraftLauncher.modHandler.removeModPack(
        params.modId,
        params.version,
      );
    } else {
      if (params.isProject) {
        return this.minecraftLauncher.modHandler.removeModByProjectId(
          params.modId,
          params.version,
          params.loader,
        );
      }
      return this.minecraftLauncher.modHandler.removeMod(
        params.modId,
        params.version,
      );
    }
  }

  async getFeaturedMods(version: string) {
    const result = {
      mcVersion: version,
      mods: [] as ModInfo[],
      modpacks: [] as ModpackInfo[],
    };

    const promisses = MinecraftManager.FEATURED_MODS.map((mod) =>
      Modrinth.fromProjectId(mod.projectId, version, ['fabric']),
    );
    const projects = await Promise.all(promisses);

    let i = 0;
    for (const project of projects) {
      if (!project) {
        console.warn(
          `Could not fetch featured mod with project ID ${MinecraftManager.FEATURED_MODS[i].projectId} given MC version ${version}`,
        );
        i++;
        continue;
      }

      if (MinecraftManager.FEATURED_MODS[i].isModPack) {
        result.modpacks.push(project.toModPackInfo());
      } else {
        result.mods.push(project.toModInfo());
      }
      i++;
    }
    return result;
  }

  getModProject(projectId: string) {
    return Modrinth.getProject(projectId);
  }

  searchMod(query: SearchProjectOptions) {
    return Modrinth.queryMods(query);
  }
}

export default MinecraftManager;
