import { ActiveBotsType, BotInfo } from '../types';
import Bot from './Bot';
import { BrowserWindow } from 'electron';

import ScriptHandler_ from './ScriptHandler';
import Settings_ from './Settings';
import Script_ from './Script';
import EventEmitter from 'node:events';
import { backendMessaging } from '../messaging';

class ActiveBots_ extends EventEmitter {
  bots: { [botId: number]: Bot } = {};
  minecraftBots: { [botId: number]: ActiveBotsType[number] } = {};
  mainWindow: BrowserWindow;
  settings: Settings_;
  scriptHandler: ScriptHandler_;
  readonly profileId: number;
  readonly profileKey: string;

  private ipRotationCounter = 0;
  private proxyRotationCounter = 0;
  /** Time the most recent join was granted. */
  private lastJoinAt?: number;
  private joinTimer?: ReturnType<typeof setTimeout>;
  private joinQueue: {
    botId: number;
    isPremium: boolean;
    script: Script_;
    resolve: (result: { cancelled: boolean }) => void;
  }[] = [];

  constructor(
    mainWindow: BrowserWindow,
    settings: Settings_,
    scriptHandler: ScriptHandler_,
    profileId: number,
    profileKey: string,
  ) {
    super();
    this.mainWindow = mainWindow;
    this.settings = settings;
    this.scriptHandler = scriptHandler;
    this.profileId = profileId;
    this.profileKey = profileKey;
    this.settings.on(`profile:appSettings:${profileKey}`, () =>
      this.processJoinQueue(),
    );
    process.once('exit', () => this.onExit());
  }

  /**
   * Space joins out by the configured `join_delay`. A single FIFO timer keeps
   * the displayed ETA accurate when a queued bot is cancelled.
   */
  waitForBotJoinRequest(
    botId: number,
    script: Script_,
    isPremium: boolean,
  ): Promise<{ cancelled: boolean }> {
    return new Promise((resolve) => {
      this.joinQueue.push({ botId, script, resolve, isPremium });
      this.processJoinQueue();
    });
  }

  /** Cancel a join still waiting in the delay queue. No-op once it was granted. */
  cancelBotJoinRequest(botId: number): void {
    const index = this.joinQueue.findIndex((join) => join.botId === botId);
    if (index === -1) return;
    const [join] = this.joinQueue.splice(index, 1);
    join.resolve({ cancelled: true });
    this.processJoinQueue();
  }

  /** Cancel every queued join owned by a script that has stopped. */
  cancelBotJoinRequestsByScript(script: Script_): void {
    const queuedJoins = this.joinQueue;
    this.joinQueue = queuedJoins.filter((join) => {
      if (join.script !== script) return true;
      join.resolve({ cancelled: true });
      return false;
    });
    if (this.joinQueue.length !== queuedJoins.length) this.processJoinQueue();
  }

  private getJoinDelay(isPremium: boolean): number {
    const appSettings = this.settings.getProfileAppSettings(this.profileKey)

    const delay = Number((isPremium ? appSettings.join_delay_premium : undefined) ?? appSettings.join_delay ?? 3000);
    return Number.isFinite(delay) ? Math.max(0, delay) : 3000;
  }

  /** Grant the next queued join as soon as the configured delay has elapsed. */
  private processJoinQueue(): void {
    if (this.joinTimer) {
      clearTimeout(this.joinTimer);
      this.joinTimer = undefined;
    }

    while (this.joinQueue.length > 0) {

      const nextQueuedBot = this.joinQueue[0];
      const joinDelay = this.getJoinDelay(nextQueuedBot.isPremium);
      const now = Date.now();
      const joinAt =
        this.lastJoinAt === undefined ? now : this.lastJoinAt + joinDelay;

      if (joinAt > now) {
        if (this.updateQueuedJoinStatuses(joinAt, joinDelay)) this.send();
        this.joinTimer = setTimeout(
          () => this.processJoinQueue(),
          joinAt - now, 
        );
        return;
      }

      const [next] = this.joinQueue.splice(0, 1);
      const bot = this.getBot(next.botId);
      let changed = false;
      if (bot && bot.script.id === next.script.id) {
        changed = bot.botInfo.status !== 'joining' || !!bot.botInfo.joinAt;
        bot.botInfo.status = 'joining';
        delete bot.botInfo.joinAt;
      }

      this.lastJoinAt = now;
      next.resolve({ cancelled: false });
      if (this.updateQueuedJoinStatuses(now + joinDelay, joinDelay) || changed)
        this.send();
    }
  }

  private updateQueuedJoinStatuses(
    firstJoinAt: number,
    joinDelay: number,
  ): boolean {
    let joinAt = firstJoinAt;
    let changed = false;

    for (const join of this.joinQueue) {
      const bot = this.getBot(join.botId);
      if (
        bot &&
        bot.script.id === join.script.id &&
        (bot.botInfo.status !== 'queued' || bot.botInfo.joinAt !== joinAt)
      ) {
        bot.botInfo.status = 'queued';
        bot.botInfo.joinAt = joinAt;
        changed = true;
      }
      joinAt += joinDelay;
    }

    return changed;
  }

  /**
   * Resolve the host a newly-joining bot should connect to.
   *
   * The target is fixed to this runtime's profile. When IP rotation is enabled we round-robin
   * over the profile's reachable IPs (its `defaultIp` plus any proxy `ips`,
   * filtered to the hosts that answered the profile scan) to spread joins out and
   * avoid rate-limit kicks. Otherwise — or when nothing is reachable — we use
   * the configured server IP.
   */
  resolveJoinHost(): { host: string; port: number } {
    const appSettings = this.settings.getProfileAppSettings(this.profileKey);
    const serverId = this.profileKey;
    const section = this.settings.JNdata?.data?.[serverId];
    const defaultPort = section?.defaultPort || 25565;

    if (appSettings.serverIpRotation) {
      const reachableIps = this.scriptHandler.getRuntime(
        this.profileId,
      ).workingIps;
      if (reachableIps.length > 0) {
        const entry =
          reachableIps[this.ipRotationCounter++ % reachableIps.length];
        return this.parseHost(entry, defaultPort);
      }
    }

    const fallback = appSettings.ip || section?.defaultIp || '';
    return this.parseHost(fallback, appSettings.port ?? defaultPort);
  }

  /** Assign a pool entry only after main has granted the queued join. */
  resolveJoinProxy(): { proxyUrl?: string; error?: string } {
    const proxy = this.settings.getProfileAppSettings(this.profileKey).proxy;
    if (!proxy?.enabled) return {};
    if (proxy.urls.length === 0)
      return { error: 'Proxy rotation is enabled but no proxies are configured.' };
    return {
      proxyUrl: proxy.urls[this.proxyRotationCounter++ % proxy.urls.length],
    };
  }

  /** Split a `host` or `host:port` entry, defaulting the port when absent. */
  private parseHost(
    entry: string,
    defaultPort: number,
  ): { host: string; port: number } {
    const [host, portPart] = entry.split(':');
    const port = portPart ? parseInt(portPart, 10) || defaultPort : defaultPort;
    return { host: host || '0.0.0.0', port };
  }
  
  addBot(botInfo: BotInfo, script: Script_) {
    if (botInfo.botId in this.bots)
      return console.info('bot is already online.');
    const bot = new Bot(botInfo, script);
    this.bots[botInfo.botId] = bot;
    this.updateBotStatus(botInfo.botId, botInfo.status, script, false);
    this.send();
  }

  updateBotStatus(
    botId: number,
    status: BotInfo['status'] | 'paused' | 'resumed',
    script: Script_,
    send = true,
  ) {
    const bot = this.bots[botId];
    if (!bot) return;
    if (bot.script.id !== script.id) return;
    if (status === 'paused') {
      bot.botInfo.paused = true;
    } else if (status === 'resumed') {
      bot.botInfo.paused = false;
    } else {
      bot.botInfo.status = status;
      if (status !== 'queued') delete bot.botInfo.joinAt;
      this.emit('bot-status-' + status, bot);
    }

    if (bot.botInfo.status === 'failed' && !bot.botInfo.paused) {
      setTimeout(() => {
        const bot = this.bots[botId];
        if (!bot || bot.botInfo.status !== 'failed' || bot.botInfo.paused)
          return;
        this.removeBot({ botId, send: true });
      }, 3000);
    }

    if (send) {
      this.send();
    }
  }

  getBot(botId: number) {
    if (botId in this.bots) {
      return this.bots[botId];
    }
    return null;
  }

  getBotByUsername(username: string) {
    for (const bot of Object.values(this.bots)) {
      if (bot.botInfo.username === username) return bot;
    }
    return null;
  }

  toArray() {
    return [
      ...Object.values(this.bots).map((bot: Bot) => bot.toObject()),
      ...Object.values(this.minecraftBots),
    ];
  }

  upsertMinecraftBot(info: {
    clientId: string;
    instanceId?: string;
    username?: string;
    uuid?: string;
    host?: string;
    port?: number;
    version?: string;
    status?: BotInfo['status'];
    paused?: boolean;
  }) {
    const botId = -Math.abs(this.hashString(`minecraft:${info.clientId}`));
    const existing = this.minecraftBots[botId];
    const username =
      info.username ??
      existing?.username ??
      `MC Client (${info.clientId.slice(0, 6)})`;

    this.minecraftBots[botId] = {
      botId,
      username,
      script: 'minecraft',
      id: info.clientId,
      version: info.version ?? existing?.version ?? 'minecraft',
      uuid: info.uuid ?? existing?.uuid,
      UID: info.uuid ?? existing?.UID ?? existing?.uuid,
      host: info.host ?? existing?.host ?? 'localhost',
      port: info.port ?? existing?.port ?? 0,
      status: info.status ?? existing?.status ?? 'connected',
      paused: info.paused ?? existing?.paused ?? false,
      origin: 'minecraft',

      SCRIPT_NAME: 'Minecraft',
      SCRIPT_ID: 'minecraft',
      INSTANCE_ID: 'minecraft',
    };
    this.send();
  }

  removeMinecraftBot(clientId: string) {
    const botId = -Math.abs(this.hashString(`minecraft:${clientId}`));
    if (!this.minecraftBots[botId]) return;
    delete this.minecraftBots[botId];
    this.send();
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return hash;
  }

  removeBot({ botId, send = true }: { botId: number; send?: boolean }) {
    if (!(botId in this.bots)) return; // console.info('bot not found.');
    const bot = this.getBot(botId);
    this.emit('bot-ended', bot);

    delete this.bots[botId];
    if (send) {
      this.send();
    }
  }

  removeBotByScript(script: Script_) {
    this.cancelBotJoinRequestsByScript(script);
    Object.values(this.bots).forEach((bot: Bot) => {
      if (
        bot.script.id === script.id &&
        (bot.botInfo.status !== 'failed' || bot.botInfo.paused)
      )
        this.removeBot({ botId: bot.botInfo.botId, send: false });
    });
    this.send();
  }

  onExit() {
    Object.values(this.bots).forEach((bot: Bot) => {
      this.removeBot({ botId: bot.botInfo.botId, send: false });
    });
  }

  send() {
    backendMessaging.messenger.publishToProfile(
      this.profileId,
      'activeBots',
      this.toArray(),
    );
    this.scriptHandler.publishRuntimeSummary(this.profileId);
  }

  getInstanceIdFromBot(botId: number) {
    return this.getBot(botId)?.script.runtimeScriptId ?? null;
  }

  isBotActive(botId: number) {
    return botId in this.bots;
  }

  toString() {
    return `${Object.values(this.bots)
      .map((bot: Bot) => bot.toString())
      .join(',\n')}`;
  }
}

export default ActiveBots_;
