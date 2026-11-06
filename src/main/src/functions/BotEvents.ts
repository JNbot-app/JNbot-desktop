import type { ScriptCooldown } from '../../../common/cooldowns';
import {
  BotInfo,
  LogMessage,
  Reminder,
  Progress,
  PluginSummary,
  ProfileScriptSummary,
  WorkerSettingsUpdate,
  WorkerLogEntry,
} from '../types';
import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { logText } from '../../../common/logText';

/** Hard cap on stored cooldowns to stop a script from spamming new ones. */
const MAX_COOLDOWNS = 10;
import Script_ from './Script';
import ActiveBots_ from './ActiveBots';
import { LogStatus } from '../../../common/CommonEnums';
import MinecraftBridgeManager from './minecraft/MinecraftBridgeManager';
import { scriptCaptureHolder } from './AutomationService';
import type { McServerEventName } from '../../../common/minecraftServers';
import { backendMessaging } from '../messaging';
import { CooldownData } from '../workers/compiler/scriptApi';
import type {
  AutomationReplayOptions,
  AutomationSessionStatus,
} from '../../../common/automation';
import { toRunnableJs } from './transpile';
import { McClientEventName } from './minecraft/bridge/McClientEventSubscriptions';
import { setProxyServer } from './minecraft/bridge/proxyServers';
import {
  accountAuthenticationError,
  isOnlineMode,
} from '../../../common/serverAuthentication';

const MC_SERVER_METHODS = new Set([
  'request',
  'getStatus',
  'executeCommand',
  'broadcast',
  'getPlayers',
  'getPlayer',
  'sendMessage',
  'kickPlayer',
  'getWorlds',
  'getWorldInfo',
  'apiList',
  'apiVersion',
  'apiCapabilities',
]);

class BotEvents_ {
  private static readonly proxyControlTokens = new Map<number, string>();
  activeBots: ActiveBots_;
  script: Script_ | null = null;
  mainWindow: BrowserWindow;
  minecraftBridgeManager: MinecraftBridgeManager;

  constructor(
    activeBots: ActiveBots_,
    mainWindow: BrowserWindow,
    minecraftBridgeManager: MinecraftBridgeManager,
  ) {
    this.activeBots = activeBots;
    this.mainWindow = mainWindow;
    this.minecraftBridgeManager = minecraftBridgeManager;
  }

  setScript(script: Script_) {
    this.script = script;
  }

  private publish(event: string, data?: unknown): void {
    if (!this.script) return;
    backendMessaging.messenger.publishToProfile(
      this.script.profile.profileId,
      event,
      data,
    );
  }

  BOT_JOINED(bot: BotInfo) {
    if (!this.script) return;
    if (this.activeBots.isBotActive(bot.botId))
      return console.info(bot.username + ' is already online.');

    this.activeBots.addBot(bot, this.script);
    this.script.scriptHandler.windowHandler.v4guardCompleteUser(bot.username);
  }
  BOT_LEFT(bot: {
    username: string;
    reason: string;
    kicked: boolean;
    botId: number;
    send?: boolean;
  }) {
    BotEvents_.proxyControlTokens.delete(bot.botId);
    const activeBot =
      this.activeBots.getBot(bot.botId) ??
      this.script?.scriptHandler.findBot(bot.botId);
    if (activeBot) activeBot.proxyControlToken = undefined;
    if (!this.script) return console.error('Script not found');
    // Check if bot is online with the same scriptId as the bot that left
    // (to fix the issue where bot is already only with another script)

    if (
      this.activeBots.getInstanceIdFromBot(bot.botId) !== this.script.instanceId
    )
      return;

    if (bot.kicked) {
      this.activeBots.updateBotStatus(bot.botId, 'failed', this.script);
      this.publish('bot-kicked', {
        username: bot.username,
        reason: bot.reason,
        scriptName: this.script.name,
        scriptId: this.script.id,
        botId: bot.botId,
      });
    } else {
      this.activeBots.removeBot({ botId: bot.botId });
    }
  }

  BOT_STATUS_UPDATE({
    botId,
    status,
  }: {
    botId: number;
    status: BotInfo['status'];
  }) {
    if (!this.script) return;
    this.activeBots.updateBotStatus(botId, status, this.script);
  }

  async BOT_JOIN_REQUEST({
    botId,
    hasProxyOverride = false,
    isPremium = false,
  }: {
    botId: number;
    hasProxyOverride?: boolean;
    isPremium?: boolean;
  }) {
    if (!this.script) return { granted: false };
    const bot = this.activeBots.getBot(botId);
    const onlineMode = isOnlineMode(this.getProfileData());
    const alt = bot
      ? this.activeBots.settings
          .getAltsWithDataForProfile(this.activeBots.profileKey)
          .find((entry) => entry.username === bot.botInfo.username)
      : undefined;
    const authenticationError = accountAuthenticationError(
      {
        premium: isPremium,
        password: alt?.data?.password,
      },
      onlineMode,
    );
    if (authenticationError)
      return { granted: false, error: authenticationError };
    const { cancelled } = await this.activeBots.waitForBotJoinRequest(
      botId,
      this.script,
      isPremium,
    );
    // The alt was skipped while waiting its turn: the worker has already moved
    // on (it resolved its own request), so don't grant a stale join.
    if (cancelled) return { granted: false, cancelled: true };

    const hostDetails = await this.activeBots.resolveJoinHost();
    if (bot && bot.script === this.script) {
      bot.botInfo.host = hostDetails.host;
      bot.botInfo.port = hostDetails.port;
    }

    // When the JNbot proxy script is running, route every bot through it so the
    // proxy can record/inspect packets. The proxy forwards to the configured
    // upstream (appSettings.ip:port) itself, so server-ip rotation is bypassed
    // while proxying — acceptable for a debug tool.
    const proxyActive =
      (this.script?.profile.activeScripts.getScriptsByName('jnbotproxy')
        ?.length ?? 0) > 0;
    const targetBot =
      this.activeBots.getBot(botId) ??
      this.script?.scriptHandler.findBot(botId);
    if (targetBot) targetBot.proxyControlToken = undefined;
    BotEvents_.proxyControlTokens.delete(botId);

    if (proxyActive) {
      const proxyControlToken = randomUUID();
      BotEvents_.proxyControlTokens.set(botId, proxyControlToken);
      if (targetBot) targetBot.proxyControlToken = proxyControlToken;
      const proxyPort =
        Number(
          this.activeBots.settings.getProfileSettings(
            this.activeBots.profileKey,
          ).scripts?.jnbotproxy?.port,
        ) || 25565;
      const connection = {
        granted: true,
        host: '127.0.0.1',
        port: proxyPort,
        viaProxy: true,
        onlineMode,
        proxyControlToken,
      };
      if (targetBot && targetBot.script === this.script) {
        targetBot.botInfo.host = connection.host;
        targetBot.botInfo.port = connection.port;
        this.activeBots.send();
      }
      return connection;
    }

    const proxyAssignment = hasProxyOverride
      ? {}
      : this.activeBots.resolveJoinProxy();
    if (proxyAssignment.error)
      return { granted: false, error: proxyAssignment.error };

    const connection = {
      granted: true,
      ...hostDetails,
      ...proxyAssignment,
    };
    if (targetBot && targetBot.script === this.script) this.activeBots.send();
    return connection;
  }

  /** Worker skipped an alt while its join was still queued — free the slot. */
  BOT_JOIN_CANCEL({ botId }: { botId: number }) {
    this.activeBots.cancelBotJoinRequest(botId);
  }

  /** The proxy is listening: list it in JNbot client mods' server list. */
  'PROXY:LISTENING'({ port }: { port: number }) {
    if (!this.script) return;
    const { profileId } = this.script.profile;
    setProxyServer(`${profileId}:${this.script.instanceId}`, { profileId, port });
  }

  async 'PROXY:REQUEST_BOT_STATE'({ botId }: { botId: number }) {
    const bot =
      this.activeBots.getBot(botId) ??
      this.script?.scriptHandler.findBot(botId);
    if (!bot) {
      throw new Error(`Bot ${botId} was not found in active bots`);
    }
    return await bot.requestAction('exportProxyState');
  }

  'PROXY:VALIDATE_BOT_PROXY'({
    botId,
    token,
  }: {
    botId: number;
    token: string;
  }) {
    if (typeof token !== 'string' || token.length === 0) return false;
    const bot =
      this.activeBots.getBot(botId) ??
      this.script?.scriptHandler.findBot(botId);
    if (bot?.proxyControlToken === token) return true;
    return BotEvents_.proxyControlTokens.get(botId) === token;
  }

  READY() {}
  ERROR(err: any) {
    if (!this.script) return console.error('Script not found');

    const macroInfo = this.script.scriptSettings.arguments?.macroInfo;
    if (macroInfo?.language === 'js') {
      // Plugin code is evaluated with the script name as its filename, so the
      // first `<name>:<line>:<col>` stack frame points into the user's code.
      const name = this.script.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const line = Number(err.stack?.match(new RegExp(`(?:\\(|at )${name}:(\\d+):\\d+`))?.[1]);
      this.publish('CODE_MACRO_ERROR', {
        ...err,
        pluginId: macroInfo.pluginId,
        line: line || undefined,
      });
    }

    const isProfileScript =
      !!this.script?.scriptHandler.profileScriptByPluginId(
        this.script.profile.profileId,
        this.script.scriptId,
      );
    if (this.script.scriptSettings.scriptName !== 'macro' || isProfileScript) {
      this.script.scriptHandler.errorHandler.handle(
        {
          message: '[SCRIPT ERROR]: ' + err.message,
          stack: err.stack,
          script: this.script.name,
        },
        this.script.profile.profileId,
      );
      this.LOG([
        [`${this.script.id} has stopped due to an error. `, LogStatus.ERROR],
      ]);
    }
    console.error('BOT ERROR: ', err);
    if (global.isMobileRuntime) {
      process.emit('jnbot-mobile-error', {
        source: 'worker:unhandled-error',
        message: err?.message ?? String(err),
        stack: err?.stack,
        script: this.script.name,
        instanceId: this.script.instanceId,
      });
    }
  }

  LOG(messages: LogMessage[]) {
    this.script?.profile.consoleHandler.log(
      messages,
      this.script.scriptId,
      this.script.name,
    );
  }

  ACTIVE_COMP(data: [{ id: string; active: boolean }]) {
    for (let comp of data) {
      this.publish('comp-' + comp.id, comp.active);
    }
  }

  PROGRESS_UPDATE(progress: Progress) {
    this.script?.updateProgress(progress);
  }

  SET_SCRIPT_CONTROLS(controls: number) {
    this.script?.setControls(controls);
  }

  REQUEST_ACCOUNT_PASSWORD({ username }: { username: string }): string | null {
    if (!this.script) throw new Error('Script not found');
    if (typeof username !== 'string' || !username.trim())
      throw new Error('Account username is required');

    const requestedUsername = username.trim();
    const alt = this.script.scriptHandler.settings.shared.alts.find(
      (entry) =>
        entry.username.toLowerCase() === requestedUsername.toLowerCase(),
    );
    if (!alt) throw new Error(`Account not found: ${requestedUsername}`);
    if (isOnlineMode(this.getProfileData())) return null;

    const password = this.script.scriptHandler.settings.getAltPassword(
      alt.username,
      this.script.profile.profileKey,
    );
    if (!password)
      throw new Error(`No password is stored for account: ${alt.username}`);
    return password;
  }

  RESTART() {
    this.script?.restart();
  }
  UPDATE_SCRIPT_OPTIONS(options: object) {
    if (!options || !this.script) return;
    this.script.options = { ...this.script.options, ...options };
  }

  UPDATE_SETTINGS(update: WorkerSettingsUpdate) {
    if (!Array.isArray(update?.alts)) return;
    this.activeBots.settings.setAltsForProfile(
      this.activeBots.profileKey,
      update.alts,
    );
  }

  SIMULATE([event, data]: [string, any]) {
    if (!this.script) return;
    void this.script.scriptHandler.clientEvents.profileAction(
      this.script.profile.profileId,
      event,
      data,
    );
  }

  async SIMULATE_INVOKE([event, data]: [string, any]) {
    if (!this.script) return console.error('Script not found');
    this.script.send(
      event,
      await this.script.scriptHandler.clientEvents.profileAction(
        this.script.profile.profileId,
        event,
        data,
      ),
    );
  }

  ACTIVE_BOTS() {
    this.script?.send('ACTIVE_BOTS', this.activeBots.toArray());
  }
  ACTIVE_SCRIPTS() {
    if (!this.script) return console.error('Script not found');
    this.script.send('ACTIVE_SCRIPTS', this.script.activeScripts.toObject());
  }

  /** Runnable library plugins (scriptType 'script'), trimmed for a picker. */
  GET_PLUGINS(): PluginSummary[] {
    const script = this.script;
    if (!script) {
      console.error('Script not found');
      return [];
    }
    return script.scriptHandler.macros
      .toList()
      .filter(
        (m) =>
          m.scriptType === 'script' &&
          !script.scriptHandler.isPluginDisallowed(
            script.profile.profileId,
            m.pluginId,
          ),
      )
      .map((m) => ({
        name: m.name,
        pluginId: m.pluginId,
        description: m.description,
      }));
  }

  /** The active server profile's runnable dashboard scripts. */
  GET_PROFILE_SCRIPTS(): Promise<ProfileScriptSummary[]> {
    if (!this.script) {
      console.error('Script not found');
      return Promise.resolve([]);
    }
    return this.script.scriptHandler.getDashboardScriptInfos(
      this.script.profile.profileId,
    );
  }

  /** Recent console logs, optionally filtered by script name. */
  GET_LOGS(filter?: { scriptName?: string; limit?: number }): WorkerLogEntry[] {
    if (!this.script) {
      console.error('Script not found');
      return [];
    }
    const consoleHandler = this.script.profile.consoleHandler;
    let logs = consoleHandler.getAllLogs();
    if (filter?.scriptName)
      logs = logs.filter((l) => l[2] === filter.scriptName);
    logs = logs.slice(-Math.min(filter?.limit ?? 50, 200));
    return logs.map((l) => ({
      text: logText(l[0]),
      level: l[1],
      scriptName: l[2],
      ts: l[4],
    }));
  }

  MICROSOFT_AUTH_CODE(data: { url: string; code: string }) {
    this.script?.scriptHandler.windowHandler.openExternal(data.url, {
      target: 'electron',
      name: 'Minecraft Authentication',
    });
  }

  ADD_ACTIVITY(activity: { username: string; server: string }) {
    if (!this.script) return;
    this.script.scriptHandler.macros.db.addActivity({
      server: activity.server,
      scriptId: this.script.scriptId,
      scriptName: this.script.name,
    });
  }

  async SCRIPT_ACTION_DATA({
    id,
    isName,
    actionName,
  }: {
    id: string;
    actionName: string;
    isName: boolean;
  }) {
    if (!this.script) return console.error('Script not found');
    const scriptHandler = this.script.scriptHandler;

    if (
      !isName &&
      scriptHandler.isPluginDisallowed(
        this.script.profile.profileId,
        actionName,
      )
    ) {
      this.script.send('SCRIPT_ACTION_DATA', {
        error: true,
        id,
        actionName,
      });
      return;
    }

    let data = isName
      ? scriptHandler.macros.scriptActionData(actionName)
      : scriptHandler.macros.getMacro(actionName, false);

    // Not in the plugin library — fall back to a profile-attached action
    // with this pluginId (freshly resolved code) so profile
    // actions run from triggers / reminders / "Run a script action".
    if ('error' in data && !isName) {
      const profileScript = scriptHandler.findProfileScript(
        this.script.profile.profileId,
        actionName,
      );
      const resolver = scriptHandler.settings.profiles?.scripts;
      if (profileScript && resolver) {
        const resolved = await resolver.resolve(profileScript, true);
        if (resolved?.code) {
          data = {
            info: resolved.info,
            code: resolved.code,
            status: 'success',
          };
        }
      }
    }

    if (
      'info' in data &&
      scriptHandler.isPluginDisallowed(
        this.script.profile.profileId,
        data.info?.pluginId,
      )
    ) {
      this.script.send('SCRIPT_ACTION_DATA', {
        error: true,
        id,
        actionName,
      });
      return;
    }

    if ('info' in data && data.info?.language === 'ts' && 'code' in data) {
      const source = (data.code as { code?: unknown }).code;
      if (typeof source === 'string') {
        data = {
          ...data,
          info: { ...data.info, language: 'js' },
          code: { code: await toRunnableJs(source, 'ts') },
        };
      }
    }

    this.script.send('SCRIPT_ACTION_DATA', { ...data, id, actionName });
  }
  SCRIPT_ACTION_START({ name, actionId }: { name: string; actionId: string }) {
    if (!this.script) return console.error('Script not found');
    this.script.profile.scriptActionHandler.startAction(name, {
      actionId,
      instanceId: this.script.instanceId,
    });
  }

  SCRIPT_ACTION_DONE({ actionId }: { actionId: string }) {
    if (!this.script) return console.error('Script not found');
    this.script.profile.scriptActionHandler.removeAction(
      actionId,
      this.script.instanceId,
    );
  }

  V4GUARD_VERIFY(data: { url: string; username: string }) {
    this.script?.scriptHandler.windowHandler.handleV4Guard(data);
  }

  async PROXY_RECORDINGS_UPDATE() {
    if (!this.script) return console.error('Script not found');
    const recordings = await this.script?.scriptHandler.recordings.update();
    this.publish('RECORDINGS', recordings);
  }

  GET_AUTOMATIONS() {
    return this.script?.scriptHandler.automationService.list();
  }

  GET_AUTOMATION(id: string) {
    return this.script?.scriptHandler.automationService.get(id);
  }

  START_AUTOMATION_RECORDING({
    clientId,
    pluginId,
    name,
  }: {
    clientId: string;
    pluginId?: string;
    name?: string;
  }) {
    return this.script?.scriptHandler.automationService.startRecording(
      clientId,
      pluginId,
      name,
    );
  }

  /** a bot's "Play with AI" run needs an up-to-date model; trains in its own worker */
  TRAIN_BRAIN(pluginId: string) {
    return this.script?.scriptHandler.automationService.brains.train(pluginId);
  }

  START_AUTOMATION_CLIENT_REPLAY({
    clientId,
    automation,
    options,
  }: {
    clientId: string;
    automation:
      | string
      | import('../../../common/automation').AutomationDocument;
    options: AutomationReplayOptions;
  }) {
    return this.script?.scriptHandler.automationService.startClientReplay(
      clientId,
      automation,
      options,
    );
  }

  CONTROL_AUTOMATION_SESSION({
    sessionId,
    action,
  }: {
    sessionId: string;
    action: 'pause' | 'resume' | 'stop';
  }) {
    return this.script?.scriptHandler.automationService.controlSession(
      sessionId,
      action,
    );
  }

  GET_AUTOMATION_SESSION(sessionId: string) {
    return this.script?.scriptHandler.automationService.sessionStatus(
      sessionId,
    );
  }

  AUTOMATION_STATUS(status: AutomationSessionStatus) {
    if (!this.script) return;
    this.script.scriptHandler.automationService.receiveWorkerStatus({
      ...status,
      target: {
        ...status.target,
        profileId: this.script.profile.profileId,
      },
    });
  }

  async MC_CLIENT_METHOD({
    clientId,
    method,
    params,
  }: {
    clientId: string;
    method: string;
    params: any;
  }) {
    // capture is shared with the app's recordings, so it goes through its single owner
    const capture = method === 'request' ? params?.method : undefined;
    if (
      this.script &&
      (capture === 'mc.automation.capture.start' ||
        capture === 'mc.automation.capture.stop')
    ) {
      const automation = this.script.scriptHandler.automationService;
      const holder = scriptCaptureHolder(
        this.script.instanceId,
        String(params.params?.sessionId ?? ''),
      );
      return capture === 'mc.automation.capture.start'
        ? automation.acquireCapture(clientId, holder, params.params)
        : automation.releaseCapture(clientId, holder);
    }
    const client = this.minecraftBridgeManager.getClient(clientId);
    // @ts-ignore - dynamic method call
    return client[method](params);
  }

  SUBSCRIBE_MC_EVENT({
    clientId,
    event,
  }: {
    clientId: string;
    event: McClientEventName;
  }) {
    if (!this.script) return { ok: false, error: 'Script not found' };
    this.minecraftBridgeManager.subscribeClientEvent(
      this.script,
      clientId,
      event,
    );
    return { ok: true };
  }

  UNSUBSCRIBE_MC_EVENT({
    clientId,
    event,
  }: {
    clientId: string;
    event: McClientEventName;
  }) {
    if (!this.script) return { ok: false, error: 'Script not found' };
    this.minecraftBridgeManager.unsubscribeClientEvent(
      this.script,
      clientId,
      event,
    );
    return { ok: true };
  }

  async GET_ACTIVE_SCRIPTS() {
    if (!this.script) return console.error('Script not found');
    return this.script.activeScripts.toObject();
  }

  async GET_PLUGIN_INFO({ pluginId }: { pluginId: string }) {
    if (!this.script) throw new Error('Script not found');
    return this.script.scriptHandler.getPluginInfo(
      this.script.profile.profileId,
      pluginId,
    );
  }

  async GET_MINECRAFT_CLIENTS() {
    return this.minecraftBridgeManager.getClients();
  }

  async MC_SERVER_METHOD({
    serverId,
    method,
    args,
  }: {
    serverId: string;
    method: string;
    args: unknown[];
  }) {
    if (!this.script) throw new Error('Script not found');
    if (!MC_SERVER_METHODS.has(method))
      throw new Error(`Unknown Minecraft server method: ${method}`);
    const server =
      this.script.scriptHandler.minecraftServerManager.managedBridge.get(
        serverId,
      );
    const handler = (server as unknown as Record<string, unknown>)[method];
    if (typeof handler !== 'function')
      throw new Error(`Unknown Minecraft server method: ${method}`);
    return (handler as (...values: unknown[]) => unknown).apply(server, args);
  }

  GET_MINECRAFT_SERVERS() {
    if (!this.script) throw new Error('Script not found');
    return this.script.scriptHandler.minecraftServerManager
      .list()
      .filter(
        (server) => server.role === 'host' && server.source === 'dedicated',
      )
      .map((server) => ({
        id: server.id,
        name: server.name,
        version: server.version,
        state: server.state,
        apiState: server.apiState,
      }));
  }

  SUBSCRIBE_MC_SERVER_EVENT({
    serverId,
    event,
  }: {
    serverId: string;
    event: McServerEventName;
  }) {
    if (!this.script) return { ok: false, error: 'Script not found' };
    this.script.scriptHandler.minecraftServerManager.managedBridge.subscribe(
      this.script,
      serverId,
      event,
    );
    return { ok: true };
  }

  UNSUBSCRIBE_MC_SERVER_EVENT({
    serverId,
    event,
  }: {
    serverId: string;
    event: McServerEventName;
  }) {
    if (!this.script) return { ok: false, error: 'Script not found' };
    this.script.scriptHandler.minecraftServerManager.managedBridge.unsubscribe(
      this.script,
      serverId,
      event,
    );
    return { ok: true };
  }

  GET_JNDATA() {
    return this.script?.scriptHandler.settings.JNdata;
  }

  /* ---------- Cooldowns (script API) ---------- */

  COOLDOWN_GET(pluginId: string) {
    const cooldowns = this.script
      ? this.script.scriptHandler.settings.getProfileSettings(
          this.script.profile.profileKey,
        ).reminders ?? []
      : [];
    return cooldowns.filter(
      (c): c is ScriptCooldown =>
        c.kind !== 'schedule' && c.pluginId === pluginId,
    );
  }

  COOLDOWN_ADD(data: {
    reminder: {
      name: string;
      reminderId?: string;
      cooldown: number;
      time?: number;
      options?: Record<string, any>;
    };
    pluginId: string;
  }): { ok: boolean; error?: string; reminder?: CooldownData } {
    const { reminder, pluginId } = data;
    if (!reminder.name || !reminder.cooldown)
      return { ok: false, error: 'Name and cooldown are required' };
    const settings = this.script?.scriptHandler.settings;
    if (!settings || !pluginId)
      return { ok: false, error: 'Settings not available' };

    const profileKey = this.script!.profile.profileKey;
    const profileSettings = settings.getProfileSettings(profileKey);
    const cooldowns = [...(profileSettings.reminders ?? [])];

    // Upsert: replace an existing cooldown this plugin owns with the same reminderId.
    const existing = reminder.reminderId
      ? cooldowns.findIndex(
          (c) =>
            c.kind !== 'schedule' &&
            c.pluginId === pluginId &&
            c.reminderId === reminder.reminderId,
        )
      : -1;

    if (
      existing === -1 &&
      cooldowns.filter((c) => c.kind !== 'schedule').length >= MAX_COOLDOWNS
    ) {
      return {
        ok: false,
        error: `Cooldown limit reached (max ${MAX_COOLDOWNS})`,
      };
    }

    const previous = cooldowns[existing];
    const keepOptions = previous?.kind !== 'schedule' && previous?.optionsEdited;
    const newCooldown: Reminder = {
      id:
        existing === -1
          ? Math.random().toString(36).substring(2, 9)
          : previous.id,
      name: reminder.name,
      pluginId,
      reminderId: reminder.reminderId,
      cooldown: reminder.cooldown,
      time: reminder.time ?? Date.now(),
      // Keep the user's edits and auto-run opt-in when a plugin updates its cooldown.
      options: keepOptions ? previous.options : reminder.options,
      optionsEdited: keepOptions || undefined,
      autoStart: previous?.autoStart,
    };

    if (existing === -1) cooldowns.push(newCooldown);
    else cooldowns[existing] = newCooldown;

    settings.updateProfileSettings(profileKey, {
      path: ['reminders'],
      value: cooldowns,
    });
    return { ok: true, reminder: newCooldown };
  }

  /**
   * Restart a cooldown's countdown by setting its start `time` to now (the
   * "ready" moment becomes now + cooldown). Matches by id when given,
   * otherwise resets every cooldown this plugin created with the supplied
   * reminderId.
   */
  COOLDOWN_RESET({
    id,
    reminderId,
    pluginId,
  }: {
    id?: string;
    reminderId?: string;
    pluginId: string;
  }): { ok: boolean; error?: string; reminders?: CooldownData[] } {
    const settings = this.script?.scriptHandler.settings;
    if (!settings || !pluginId)
      return { ok: false, error: 'Settings not available' };

    const profileKey = this.script!.profile.profileKey;
    const profileSettings = settings.getProfileSettings(profileKey);
    const updated: ScriptCooldown[] = [];
    const now = Date.now();
    const next = (profileSettings.reminders ?? []).map((c) => {
      if (c.kind === 'schedule' || c.pluginId !== pluginId) return c;
      const match = id
        ? c.id === id
        : reminderId
          ? c.reminderId === reminderId
          : false;
      if (!match) return c;
      const reset = { ...c, time: now };
      updated.push(reset);
      return reset;
    });

    if (updated.length === 0) {
      return {
        ok: false,
        error:
          'No matching cooldown found (' +
          (id ?? reminderId ?? 'unknown') +
          ')',
      };
    }

    settings.updateProfileSettings(profileKey, {
      path: ['reminders'],
      value: next,
    });
    return { ok: true, reminders: updated };
  }

  /** Remove one of this plugin's cooldowns by id. */
  COOLDOWN_REMOVE({ id, pluginId }: { id?: string; pluginId: string }): {
    ok: boolean;
    error?: string;
  } {
    const settings = this.script?.scriptHandler.settings;
    if (!settings || !pluginId)
      return { ok: false, error: 'Settings not available' };
    if (!id) return { ok: false, error: 'An id is required' };

    const profileKey = this.script!.profile.profileKey;
    const profileSettings = settings.getProfileSettings(profileKey);
    const cooldowns = profileSettings.reminders ?? [];
    const next = cooldowns.filter(
      (c) => !(c.kind !== 'schedule' && c.id === id && c.pluginId === pluginId),
    );
    if (next.length === cooldowns.length) {
      return {
        ok: false,
        error: 'No matching cooldown found (' + (id ?? 'unknown') + ')',
      };
    }

    settings.updateProfileSettings(profileKey, {
      path: ['reminders'],
      value: next,
    });
    return { ok: true };
  }


  private getProfileData() {
    const script = this.script;
    return script
      ? script.scriptHandler.settings.getProfile(script.profile.profileKey)
          ?.data
      : undefined;
  }
}

export default BotEvents_;
