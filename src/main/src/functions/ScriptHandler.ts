import { tickReminders } from '../../../common/cooldowns';
import { chainIdFromPluginId } from '../../../common/chains';
import Script from './Script';
import { toRunnableJs } from './transpile';
import type {
  MacroInfo,
  ScriptActionInfo,
  Bot,
  MinecraftInstancesType,
  ExtendedProgress,
  JNdataDataSection,
  ProfileScriptSummary,
} from '../types';
import type { ProfileScript } from '../../../common/profileScripts';
import { BrowserWindow } from 'electron';
import WindowHandler_ from './WindowHandler';
import ClientEvents from './ClientEvents';
import pingServer from './minecraft/pingServer';
import Settings_ from './Settings';
import WebRTC_nodejs from '../../../common/WebRTC_nodejs';
import DeviceHandler from './peer2peer/DeviceHandler';
import Macros_ from './Macros';
import Recordings from './storage/Recordings';
import AutomationService from './AutomationService';
import Script_ from './Script';
import MinecraftInstances from './minecraft/MinecraftInstances';
import MinecraftSessions from './minecraft/MinecraftSessions';
import MinecraftManager from './minecraft/MinecraftManager';
import MinecraftBridgeManager from './minecraft/MinecraftBridgeManager';
import MinecraftBridgeEvents from './minecraft/bridge/MinecraftBridgeEvents';
import MinecraftServerManager from './minecraftServer/MinecraftServerManager';
import { getMcBridgeServer } from './minecraft/bridge';
import {
  proxyPort,
  setProxyServer,
  setProxyStarter,
  waitForProxy,
} from './minecraft/bridge/proxyServers';
import { TypedEventEmitter } from '../../../common/TypedEventEmitter';
import ErrorHandler_ from './ErrorHandler';
import CloudStorage from './storage/CloudStorage';
import { RunIdAllocator } from '../../../common/messaging';
import ProfileRuntime from './ProfileRuntime';
import { backendMessaging } from '../messaging';
import type { ProfileRuntimeSummary } from '../../../common/profileRuntime';
import { isPluginDisallowed } from '../../../common/profiles';

interface ScriptHandlerEvents extends Record<string, (...args: any) => any> {
  PROGRESS_UPDATE: (progress: ExtendedProgress, script: Script_) => void;
  RUNTIME_ACTIVITY_CHANGED: () => void;
  RUNTIME_SUMMARY_CHANGED: (summary: ProfileRuntimeSummary) => void;
}

const isDev = process.env.NODE_ENV === 'development';

/** Per-host ping timeout. */
const PING_TIMEOUT = 5000;

export type ScriptDataType = {
  script: string; // the name that will be visible
  scriptId?: string; // The id of the script/plugin
  arguments?: ScriptArguments;
  scriptName?: string; // scriptname will be the filename of the script that has to run
};

export type ScriptArguments = {
  isMacro?: boolean;
  macroInfo?: MacroInfo;
  components?: unknown;
  optionOverrides?: Record<string, any>;
} & Record<string, unknown>;

class ScriptHandler_ extends TypedEventEmitter<ScriptHandlerEvents> {
  settings: Settings_;
  mainWindow: BrowserWindow;
  macros: Macros_;
  clientEvents: ClientEvents;
  errorHandler: ErrorHandler_;
  deviceHandler: DeviceHandler;
  windowHandler: WindowHandler_;
  webRTCHandler: WebRTC_nodejs;
  recordings: Recordings;
  automationService: AutomationService;

  minecraftInstances: MinecraftInstances;
  minecraftSessions: MinecraftSessions;
  minecraftManager: MinecraftManager;
  minecraftBridgeManager: MinecraftBridgeManager;
  minecraftBridgeEvents: MinecraftBridgeEvents;
  minecraftServerManager: MinecraftServerManager;

  private cloudStorage: CloudStorage | null = null;
  private readonly runtimesById = new Map<number, ProfileRuntime>();
  private readonly runtimesByKey = new Map<string, ProfileRuntime>();
  private readonly activeIpRefreshes = new Map<number, Promise<string[]>>();

  private readonly scriptIds = new RunIdAllocator('script');
  /** Shared run-local bot allocator used by every worker. */
  private readonly botIdArray = new Uint16Array(
    new SharedArrayBuffer(Uint16Array.BYTES_PER_ELEMENT),
  );

  /** How often cooldowns are checked for auto-run readiness. */
  private static readonly COOLDOWN_TICK_MS = 10_000;

  constructor(
    settings: Settings_,
    mainWindow: BrowserWindow,
    macros: Macros_,
    errorHandler: ErrorHandler_,
    webRTCHandler: WebRTC_nodejs,
  ) {
    super();
    this.macros = macros;
    this.settings = settings;
    this.mainWindow = mainWindow;
    this.webRTCHandler = webRTCHandler;
    this.windowHandler = new WindowHandler_(mainWindow);

    this.clientEvents = new ClientEvents(
      settings,
      this,
      macros,
      this.windowHandler,
    );

    this.deviceHandler = new DeviceHandler(this.clientEvents, settings);

    this.recordings = new Recordings();

    this.minecraftInstances = new MinecraftInstances();
    this.minecraftSessions = new MinecraftSessions();

    this.minecraftBridgeEvents = new MinecraftBridgeEvents(
      this.settings,
      (instanceId) => {
        const profileId = instanceId
          ? this.minecraftManager?.profileIdForInstance(instanceId)
          : undefined;
        return profileId ? this.getRuntime(profileId).profileKey : undefined;
      },
    );

    this.minecraftBridgeManager = new MinecraftBridgeManager(
      this.minecraftInstances,
      this.minecraftSessions,
      (instanceId) => {
        const profileId = instanceId
          ? this.minecraftManager?.profileIdForInstance(instanceId)
          : undefined;
        return profileId ? this.getRuntime(profileId).activeBots : undefined;
      },
      this.minecraftBridgeEvents,
    );

    this.on('PROGRESS_UPDATE', (progress, script) => {
      const mcBridge = getMcBridgeServer();
      backendMessaging.messenger.publishToProfile(
        script.profile.profileId,
        'PROGRESS_UPDATE',
        progress,
      );
      if (!mcBridge) return;

      mcBridge.broadcastCommand('hud.scriptProgress', {
        instanceId: progress.instanceId,
        scriptId: script.scriptId,
        scriptName: script.name,
        current: progress.current,
        total: progress.total,
        ts: Date.now(),
      });
    });

    this.minecraftManager = new MinecraftManager(
      this.settings,
      this.minecraftInstances,
      this.minecraftSessions,
      () => this.minecraftBridgeManager.ensureMcBridgeServer(),
      () => this.minecraftBridgeManager.scheduleIdleStop(),
    );

    this.minecraftServerManager = new MinecraftServerManager(
      this.minecraftBridgeManager,
    );
    this.automationService = new AutomationService(
      this.macros,
      this.minecraftBridgeManager,
      this.minecraftSessions,
    );

    this.minecraftInstances.on(
      'changed',
      (instances: MinecraftInstancesType) => {
        instances.forEach((inst: MinecraftInstancesType[number]) => {
          const ownerId = this.minecraftManager.profileIdForInstance(
            inst.instanceId,
          );
          const runtime = ownerId ? this.getRuntime(ownerId) : undefined;
          if (!runtime) return;
          if (inst.status === 'running' || inst.status === 'starting') {
            runtime.activeScripts.upsertMinecraftInstance({
              instanceId: inst.instanceId,
              requestedVersion: inst.requestedVersion,
              stage: inst.stage,
              status: inst.status,
              pid: inst.pid,
              clientId: inst.clientId,
            });
          } else {
            runtime.activeScripts.removeMinecraftInstance(inst.instanceId);
          }
        });
      },
    );

    this.errorHandler = errorHandler;
    setProxyStarter({
      defaultPort: () => this.proxyConfigPort(this.bootstrapRuntime.profileId),
      start: (minecraftInstanceId) => this.startProxy(minecraftInstanceId),
    });
    // A fresh install has no profile yet; the renderer asks to install one.
    if (settings.getProfile(settings.bootstrapProfileKey))
      void this.updateActiveIps().catch((error) =>
        console.warn('Failed to refresh active IPs', error),
      );
  }

  /** Runtime of the bootstrap profile, created on first use. */
  private get bootstrapRuntime(): ProfileRuntime {
    return this.enableProfile(this.settings.bootstrapProfileKey);
  }

  enableProfile(profileKey: string): ProfileRuntime {
    const existing = this.runtimesByKey.get(profileKey);
    if (existing) return existing;
    if (!this.settings.getProfile(profileKey)) {
      throw new Error(`Unknown profile: ${profileKey}`);
    }
    this.settings.activateProfile(profileKey);
    this.settings.emit('profile:loaded', profileKey);
    const profileId = backendMessaging.profileId(profileKey);
    const runtime = new ProfileRuntime(
      profileId,
      profileKey,
      this.settings,
      this.mainWindow,
      this,
    );
    this.runtimesById.set(profileId, runtime);
    this.runtimesByKey.set(profileKey, runtime);
    runtime.activeScripts.on('script-ended', (instanceId: number) => {
      const mcBridge = getMcBridgeServer();
      mcBridge?.broadcastCommand('hud.scriptProgress.remove', {
        profileId,
        instanceId,
      });
      setProxyServer(`${profileId}:${instanceId}`);
      this.emit('RUNTIME_ACTIVITY_CHANGED');
    });
    const stats = this.settings.stats;
    runtime.activeBots.on('bot-status-connected', (bot: Bot) => {
      stats.incrementBotCount(bot.botInfo.username);
      this.emit('RUNTIME_ACTIVITY_CHANGED');
    });
    runtime.activeBots.on('bot-ended', (bot: Bot) => {
      if (bot.botInfo.status === 'connected')
        stats.stopPlayTime(bot.botInfo.username);
      this.emit('RUNTIME_ACTIVITY_CHANGED');
    });
    runtime.activeScripts.on('script-started', (script: Script_) => {
      stats.incrementScriptCount(script.name);
      this.emit('RUNTIME_ACTIVITY_CHANGED');
    });
    runtime.cooldownTimer = setInterval(
      () => this.tickCooldowns(profileId),
      ScriptHandler_.COOLDOWN_TICK_MS,
    );
    return runtime;
  }

  getRuntime(profileId: number): ProfileRuntime {
    const runtime = this.runtimesById.get(profileId);
    if (!runtime) throw new Error(`Profile runtime not enabled: ${profileId}`);
    return runtime;
  }

  getRuntimeByKey(profileKey: string): ProfileRuntime | undefined {
    return this.runtimesByKey.get(profileKey);
  }

  findBot(botId: number): Bot | null {
    for (const runtime of this.runtimesById.values()) {
      const bot = runtime.activeBots.getBot(botId);
      if (bot) return bot;
    }
    return null;
  }

  getRuntimeSummaries(profileKeys?: readonly string[]): ProfileRuntimeSummary[] {
    const allowed = profileKeys && new Set(profileKeys);
    return Array.from(this.runtimesById.values(), (runtime) => {
      if (allowed && !allowed.has(runtime.profileKey)) return undefined;
      return this.getRuntimeSummary(runtime);
    }).filter((summary): summary is ProfileRuntimeSummary => !!summary);
  }

  publishRuntimeSummary(profileId: number): void {
    const runtime = this.runtimesById.get(profileId);
    if (!runtime) return;
    const summary = this.getRuntimeSummary(runtime);
    backendMessaging.messenger.publishToProfile(
      profileId,
      'profiles:runtime-summary',
      summary,
    );
    this.emit('RUNTIME_SUMMARY_CHANGED', summary);
  }

  private getRuntimeSummary(runtime: ProfileRuntime): ProfileRuntimeSummary {
    const scripts = Object.values(runtime.activeScripts.toObject()).filter(
      (script) => script.origin !== 'minecraft',
    ).length;
    return {
      profileKey: runtime.profileKey,
      scripts,
      bots: runtime.activeBots.toArray().length,
    };
  }

  /** CLI compatibility only; client events must use an explicit profile id. */
  getBootstrapRuntime(): ProfileRuntime {
    return this.bootstrapRuntime;
  }

  /** Switch the runtime targeted by legacy/bootstrap CLI commands. */
  selectBootstrapProfile(profileKey: string): ProfileRuntime | null {
    if (!this.settings.selectBootstrapProfile(profileKey)) return null;
    const runtime = this.enableProfile(profileKey);
    void this.updateActiveIps(runtime.profileId).catch((error) =>
      console.warn('Failed to refresh active IPs', error),
    );
    return runtime;
  }

  private proxyConfigPort(profileId: number) {
    const { scripts } = this.settings.getProfileSettings(
      this.getRuntime(profileId).profileKey,
    );
    return Number(scripts?.jnbotproxy?.port) || 25565;
  }

  /** Starts (or reuses) the proxy of the profile that launched a Minecraft instance. */
  private async startProxy(minecraftInstanceId?: string) {
    const profileId =
      (minecraftInstanceId &&
        this.minecraftManager.profileIdForInstance(minecraftInstanceId)) ||
      this.bootstrapRuntime.profileId;
    const running = proxyPort(profileId);
    if (running) return running;
    const { activeScripts } = this.getRuntime(profileId);
    if (!activeScripts.getScriptsByName('jnbotproxy').length)
      await this.runScript(profileId, { script: 'jnbotproxy', arguments: {} });
    return waitForProxy(profileId);
  }

  stop(profileId: number, instanceId?: number) {
    const runtime =
      instanceId === undefined
        ? this.bootstrapRuntime
        : this.getRuntime(profileId);
    const target = instanceId ?? profileId;
    const s = runtime.activeScripts.getScript(target);
    if (s) s.stop();
  }

  stopAllScripts(profileId = this.bootstrapRuntime.profileId) {
    Object.values(this.getRuntime(profileId).activeScripts.scripts).forEach(
      (s) => s.stop(),
    );
  }

  restartScript(profileId: number, instanceId?: number) {
    const runtime =
      instanceId === undefined
        ? this.bootstrapRuntime
        : this.getRuntime(profileId);
    runtime.activeScripts.scripts[instanceId ?? profileId]?.restart(true);
  }

  async runScript(
    profileIdOrData: number | ScriptDataType,
    maybeScriptData?: ScriptDataType,
  ) {
    const runtime =
      typeof profileIdOrData === 'number'
        ? this.getRuntime(profileIdOrData)
        : this.bootstrapRuntime;
    const scriptData =
      typeof profileIdOrData === 'number' ? maybeScriptData! : profileIdOrData;
    const requestedPluginId =
      scriptData.script === 'macro'
        ? scriptData.arguments?.macroInfo?.pluginId ?? scriptData.scriptId
        : undefined;
    if (this.isPluginDisallowed(runtime.profileId, requestedPluginId))
      return [];
    let scriptName = scriptData.script;
    // Chains run like plugins under a `chain:<id>` pluginId.
    if (chainIdFromPluginId(requestedPluginId)) {
      if (!this.toChainScript(runtime, requestedPluginId!, scriptData))
        return [];
      scriptName = 'chain';
    }
    const instanceId = this.scriptIds.allocate();

    if (scriptName === 'macro') {
      const args = (scriptData.arguments ??= {});
      args.isMacro = true;

      // Profile scripts run by pluginId, exactly like library plugins. When the
      // requested pluginId belongs to an active-server profile script it takes
      // priority and is resolved here. Any
      // macroInfo/components the caller sent are ignored in favour of the
      // freshly-resolved copy.
      const profileScript = args.macroInfo?.pluginId
        ? this.profileScriptByPluginId(
            runtime.profileId,
            args.macroInfo.pluginId,
          )
        : undefined;
      if (profileScript) {
        const resolver = this.settings.profiles?.scripts;
        if (!resolver) {
          console.error(
            '[ScriptHandler] profile-script run requested but resolver not wired',
          );
          return [];
        }
        const resolved = await resolver.resolve(profileScript, true);
        if (!resolved?.code) {
          console.error(
            '[ScriptHandler] failed to resolve profile script',
            profileScript.id,
          );
          return [];
        }
        args.macroInfo = resolved.info;
        args.components = resolved.code;
      }

      if (!args.components) {
        const initialMacroInfo = args.macroInfo;
        if (!initialMacroInfo) return [];
        let macroInfo = initialMacroInfo;

        if (!macroInfo.pluginId) {
          let _macroInfo = this.macros
            .toList()
            .find((m) => m.name === macroInfo.name);
          if (!_macroInfo) return [];
          macroInfo = _macroInfo;
          args.macroInfo = macroInfo;
        }

        const macroCode = this.macros.getMacro(
          macroInfo.pluginId,
          macroInfo.language !== undefined,
        );

        if (macroCode.status === 'error') return macroCode; // TODO: show error  {error: "...",status:"..." }
        if (macroCode.status === 'success' && macroCode.info) {
          macroInfo = macroCode.info;
          args.macroInfo = macroInfo;
        }

        args.components = macroCode.code;
      }

      const macroInfo = args.macroInfo;
      if (!macroInfo) return [];
      scriptData.script = macroInfo.name;
      scriptData.scriptId = macroInfo.pluginId;
      if (this.isPluginDisallowed(runtime.profileId, macroInfo.pluginId))
        return [];

      // TypeScript plugins are stored as raw `.ts`; strip types here in the
      // main process so the worker only ever runs plain JavaScript. The code
      // object is freshly resolved per run, so mutating it in place is safe.
      const components = args.components as { code?: string } | undefined;
      if (macroInfo.language === 'ts' && typeof components?.code === 'string') {
        components.code = await toRunnableJs(components.code, 'ts');
      }
    }
    const sharedArray = this.botIdArray;

    const activeScripts = runtime.activeScripts.getScriptsByScriptId(
      scriptData.scriptId!,
    );

    if (activeScripts.length >= 8) {
      if (isDev)
        console.warn(
          'You cannot activate more than 8 (the same) scripts at once',
        );
      return [];
    }

    if (!scriptData.script) return [];

    const script = new Script(
      {
        ...scriptData,
        scriptName: scriptName,
        scriptId: scriptData.scriptId ?? scriptName,
      },
      this,
      runtime,
      {
        instanceId,
      },
      sharedArray,
    );
    runtime.activeScripts.prepare(script);

    return [await script.run()];
  }

  /**
   * Turn a `chain:<id>` plugin run into the chain runner's script data, read
   * from the profile's saved chain and its run settings. False when the chain
   * no longer exists.
   */
  private toChainScript(
    runtime: ProfileRuntime,
    pluginId: string,
    scriptData: ScriptDataType,
  ): boolean {
    const chainId = chainIdFromPluginId(pluginId)!;
    const { scripts } = this.settings.getProfileSettings(runtime.profileKey);
    const chain = scripts?.chains?.[chainId];
    if (!chain) return false;
    const options = { ...chain.options, ...scripts[chainId] };
    const name = options.name ?? chain.name ?? 'Chain';
    scriptData.script = name;
    scriptData.scriptId = pluginId;
    scriptData.arguments = { ...chain, name, options };
    return true;
  }

  /**
   * Run a plugin by its id, wherever it lives. An active-server profile script
   * (profile-specific plugin / action) takes priority; otherwise the user's
   * own library plugin/action is used. `optionOverrides` replaces the stored
   * script options for this single run (e.g. a cooldown replaying the gamemode
   * it was created for). Resolves `false` when no plugin matches the id.
   */
  async runByPluginId(
    profileId: number,
    pluginId: string,
    optionOverrides?: Record<string, any>,
  ): Promise<boolean> {
    if (!pluginId || this.isPluginDisallowed(profileId, pluginId)) return false;

    const known =
      !!chainIdFromPluginId(pluginId) ||
      !!this.profileScriptByPluginId(profileId, pluginId) ||
      this.macros.toList().some((m) => m.pluginId === pluginId);
    if (!known) {
      console.error(
        '[ScriptHandler] runByPluginId: no plugin found for',
        pluginId,
      );
      return false;
    }

    // runScript resolves profile-script-vs-library by pluginId. `optionOverrides`
    // is read by the worker's runner and merged over the stored settings.
    await this.runScript(profileId, {
      script: 'macro',
      arguments: {
        devMode: false,
        optionOverrides,
        macroInfo: { pluginId } as MacroInfo,
      },
    });
    return true;
  }

  /** The active server's profile script (any source) owning `pluginId`. */
  public profileScriptByPluginId(
    profileId: number,
    pluginId: string,
  ): ProfileScript | undefined {
    const data = this.settings.JNdata?.data?.[
      this.getRuntime(profileId).profileKey
    ] as
      | { scripts?: ProfileScript[] }
      | undefined;
    return data?.scripts?.find((s) => s.pluginId === pluginId);
  }

  /** True when this runtime profile explicitly blocks the plugin. */
  public isPluginDisallowed(profileId: number, pluginId?: string): boolean {
    return isPluginDisallowed(
      this.settings.JNdata?.data?.[this.getRuntime(profileId).profileKey],
      pluginId,
    );
  }

  /**
   * Consume due cooldowns/schedules before dispatching their scripts.
   * Legacy cooldowns restart; schedules advance from their original anchor.
   * Reads the live settings each tick so it always reflects cooldowns
   * added/edited/removed by the user or a plugin. Option overrides are applied
   * per-run through `runByPluginId` (→ runner → resolvePluginOptions), never by
   * mutating the stored script settings.
   */
  private tickCooldowns(profileId: number) {
    const runtime = this.getRuntime(profileId);
    const now = Date.now();
    const previousTickAt = runtime.cooldownLastTickAt;
    runtime.cooldownLastTickAt = now;
    const profileSettings = this.settings.getProfileSettings(
      runtime.profileKey,
    );
    const cooldowns = profileSettings?.reminders;
    if (!cooldowns?.length) return;

    const { next, fired, changed } = tickReminders(
      cooldowns,
      now,
      previousTickAt,
    );
    if (!changed) return;
    this.settings.updateProfileSettings(runtime.profileKey, {
      path: ['reminders'],
      value: next,
    });
    for (const c of fired) {
      if (this.isPluginDisallowed(profileId, c.pluginId)) continue;
      runtime.activeScripts
        .getScriptsByScriptId(c.pluginId)
        .forEach((s) => s.stop());
      void this.runByPluginId(profileId, c.pluginId, c.options).catch(
        (error) => {
          console.error(
            '[ScriptHandler] Scheduled run failed:',
            c.pluginId,
            error,
          );
        },
      );
    }
  }

  public getActions(): MacroInfo[] {
    return this.macros.getScriptActions();
  }

  /**
   * Script actions offered to the action pickers (triggers, cooldowns,
   * "Run a script action", chains). Combines the user's library action
   * plugins with the active server's profile-attached action scripts.
   * Profile entries are tagged `profile: true` so the UI can group them;
   * their info comes from the url info cache, so this stays cheap.
   */
  public async getUiActions(profileId: number): Promise<ScriptActionInfo[]> {
    const library = this.macros.getScriptActions();
    const profile = await this.getProfileActions(profileId);
    // One entry per pluginId: duplicate keys break the pickers' virtual lists.
    // The library copy wins, matching which code an action runs.
    const byId = new Map<string, ScriptActionInfo>();
    for (const action of [...library, ...profile]) {
      if (!byId.has(action.pluginId) && !this.isPluginDisallowed(profileId, action.pluginId))
        byId.set(action.pluginId, action);
    }
    return [...byId.values()];
  }

  /**
   * Profile-attached scripts for the active server (predefined or custom)
   * that aren't plain library references — i.e. `url`/`bundled` sources.
   * `kind: 'plugin'` scripts already appear in the library action list, so
   * surfacing them again would just duplicate them.
   */
  private profileScripts(profileId: number): ProfileScript[] {
    const data = this.settings.JNdata?.data?.[
      this.getRuntime(profileId).profileKey
    ] as
      | { scripts?: ProfileScript[] }
      | undefined;
    return (data?.scripts ?? []).filter((s) => s.source?.kind !== 'plugin');
  }

  /** The active server's profile action script matching `pluginId`, if any. */
  public findProfileScript(
    profileId: number,
    pluginId: string,
  ): ProfileScript | undefined {
    return this.profileScripts(profileId).find((s) => s.pluginId === pluginId);
  }

  /**
   * The active server's dashboard scripts — non-hidden profile scripts in
   * profile order, matching what the dashboard shows. Unlike
   * {@link profileScripts} this keeps `plugin`-kind references, since
   * those are runnable from the dashboard too.
   */
  public dashboardScripts(profileId: number): ProfileScript[] {
    const data = this.settings.JNdata?.data?.[
      this.getRuntime(profileId).profileKey
    ] as { scripts?: ProfileScript[] } | undefined;
    return (data?.scripts ?? []).filter((s) => !s.hidden);
  }

  /**
   * Resolved display info for the active server's dashboard scripts. Lets
   * callers offer a runnable list without handling the raw `ProfileScript`
   * source (e.g. the Discord bot's `/run-script` picker).
   */
  public async getDashboardScriptInfos(
    profileId: number,
  ): Promise<ProfileScriptSummary[]> {
    const resolver = this.settings.profiles?.scripts;
    const scripts = this.dashboardScripts(profileId).filter(
      (s) => !this.isPluginDisallowed(profileId, s.pluginId),
    );
    if (!resolver) {
      return scripts.map((s) => ({
        id: s.id,
        pluginId: s.pluginId,
        name: s.pluginId,
        description: '',
      }));
    }
    const resolved = await Promise.all(
      scripts.map(async (s) => {
        const r = await (resolver.resolveInfo ? resolver.resolveInfo(s) : resolver.resolve(s)).catch(() => null);
        return {
          id: s.id,
          pluginId: s.pluginId,
          name: r?.info?.name ?? s.pluginId,
          description: r?.info?.description ?? '',
        };
      }),
    );
    return resolved;
  }

  /** Resolved (cached) info for the active server's profile *action* scripts. */
  private async getProfileActions(
    profileId: number,
  ): Promise<ScriptActionInfo[]> {
    const resolver = this.settings.profiles?.scripts;
    if (!resolver) return [];
    const resolved = await Promise.all(
      this.profileScripts(profileId).map((s) => resolver.resolve(s)),
    );
    return resolved
      .filter((r) => r?.info?.scriptType === 'action')
      .map(
        (r): ScriptActionInfo => ({
          ...(r!.info as MacroInfo),
          profile: true,
        }),
      );
  }

  /** Refresh the list of reachable IPs for one profile runtime. */
  async updateActiveIps(profileIdOrKey?: number | string): Promise<string[]> {
    const runtime =
      typeof profileIdOrKey === 'number'
        ? this.getRuntime(profileIdOrKey)
        : profileIdOrKey
          ? this.enableProfile(profileIdOrKey)
          : this.bootstrapRuntime;
    const existing = this.activeIpRefreshes.get(runtime.profileId);
    if (existing) return existing;

    const refresh = this.refreshActiveIps(runtime);
    this.activeIpRefreshes.set(runtime.profileId, refresh);
    try {
      return await refresh;
    } finally {
      if (this.activeIpRefreshes.get(runtime.profileId) === refresh)
        this.activeIpRefreshes.delete(runtime.profileId);
    }
  }

  private async refreshActiveIps(runtime: ProfileRuntime): Promise<string[]> {
    const ips = await this.getActiveIps(runtime.profileKey);
    runtime.workingIps = ips;
    return ips;
  }

  /**
   * Ping every host configured on a profile (its `defaultIp` plus any proxy
   * `ips`) and return the ones that respond. Hosts are pinged in parallel;
   * a `host:port` entry overrides the profile's `defaultPort`. The original
   * entry string is returned unchanged so downstream IP-rotation keeps any
   * inline port.
   */
  async getActiveIps(serverId?: string): Promise<string[]> {
    const id = serverId ?? this.settings.bootstrapProfileKey;
    const section = id ? this.settings.JNdata?.data?.[id] : undefined;
    if (!section) return [];

    const hosts = this.collectProfileIps(section);
    const defaultPort = section.defaultPort || 25565;

    if (this.settings.getProfileAppSettings(id).auto_ping_servers === false) {
      return hosts;
    }

    const results = await Promise.all(
      hosts.map((entry) => this.pingHost(entry, defaultPort)),
    );
    const activeIps = results.filter((ip): ip is string => Boolean(ip));

    // The default host is the profile's canonical join address. Keep it in
    // the supported list even when the status endpoint does not respond;
    // some servers accept bot connections without answering this probe.
    const defaultIp = section.defaultIp?.trim();
    if (defaultIp && !activeIps.includes(defaultIp)) activeIps.unshift(defaultIp);

    return activeIps;
  }

  /** Trimmed, de-duplicated list of a profile's default + proxy IPs. */
  private collectProfileIps(section: JNdataDataSection): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of [section.defaultIp, ...(section.ips ?? [])]) {
      const ip = raw?.trim();
      if (!ip || seen.has(ip)) continue;
      seen.add(ip);
      out.push(ip);
    }
    return out;
  }

  /** Ping a single host; resolves to the entry string when reachable. */
  private async pingHost(
    entry: string,
    defaultPort: number,
  ): Promise<string | undefined> {
    const bracketed = entry.match(/^\[([^\]]+)](?::(\d+))?$/);
    const separator =
      entry.indexOf(':') === entry.lastIndexOf(':')
        ? entry.lastIndexOf(':')
        : -1;
    const host =
      bracketed?.[1] ?? (separator > 0 ? entry.slice(0, separator) : entry);
    const portPart =
      bracketed?.[2] ?? (separator > 0 ? entry.slice(separator + 1) : '');
    const port = portPart ? parseInt(portPart, 10) || defaultPort : defaultPort;
    try {
      await pingServer(host, port, PING_TIMEOUT);
      return entry;
    } catch {
      return undefined;
    }
  }

  public getCloudStorage() {
    if (!this.cloudStorage) {
      this.cloudStorage = new CloudStorage(this);
    }

    return this.cloudStorage;
  }
}

export default ScriptHandler_;
