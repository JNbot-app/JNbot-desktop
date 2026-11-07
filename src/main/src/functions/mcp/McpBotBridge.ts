import type ScriptHandler from '../ScriptHandler';
import type Bot from '../Bot';
import type Script from '../Script';
import { backendMessaging } from '../../messaging';
import { randomUUID } from 'node:crypto';
import type { McpBotTarget } from '../../../../common/mcp';

type BotTarget = { profileId: number; botId: number };

type JoinState = 'queued' | 'joining' | 'connected' | 'failed';

type JoinAttempt = {
  joinId: string;
  key: string;
  clientId: string;
  profileId: number;
  username: string;
  optionsKey: string;
  sessionId: number;
  state: JoinState;
  botId?: number;
  observedBot?: boolean;
  settled?: boolean;
  error?: string;
  updatedAt: number;
  completion: Promise<void>;
};

export class McpBotBridge {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly sessions = new Map<string, Script>();
  private readonly startingSessions = new Map<string, Promise<Script>>();
  private readonly joinAttempts = new Map<string, JoinAttempt>();
  private readonly joinsByAccount = new Map<string, string>();

  constructor(private readonly scriptHandler: ScriptHandler) {}

  listProfiles() {
    return this.scriptHandler.getRuntimeSummaries().map((profile) => {
      const runtime = this.scriptHandler.getRuntimeByKey(profile.profileKey)!;
      return {
        profileId: runtime.profileId,
        profileKey: profile.profileKey,
        activeBots: profile.bots,
        activeScripts: profile.scripts,
      };
    });
  }

  listAccounts(profileId: number) {
    const runtime = this.scriptHandler.getRuntime(profileId);
    return this.scriptHandler.settings
      .getAltsWithDataForProfile(runtime.profileKey)
      .map((account) => ({ username: account.username }));
  }

  listBots(profileId?: number) {
    const profiles = profileId
      ? [this.scriptHandler.getRuntime(profileId)]
      : this.scriptHandler
          .getRuntimeSummaries()
          .map(
            ({ profileKey }) => this.scriptHandler.getRuntimeByKey(profileKey)!,
          );
    return profiles.flatMap((runtime) =>
      runtime.activeBots
        .toArray()
        .filter((bot) => bot.botId >= 0 && bot.origin !== 'minecraft')
        .map((bot) => ({
          profileId: runtime.profileId,
          profileKey: runtime.profileKey,
          ...bot,
        })),
    );
  }

  listActiveRuns(profileId?: number) {
    const profiles = profileId
      ? [this.scriptHandler.getRuntime(profileId)]
      : this.scriptHandler
          .getRuntimeSummaries()
          .map(
            ({ profileKey }) => this.scriptHandler.getRuntimeByKey(profileKey)!,
          );
    return profiles.flatMap((runtime) =>
      Object.values(runtime.activeScripts.toObject()).map((run) => ({
        profileId: runtime.profileId,
        profileKey: runtime.profileKey,
        ...run,
      })),
    );
  }

  /** Model-facing context is compact unless an account search is requested. */
  context(profileKeys: string[], accountQuery?: string) {
    const allowed = new Set(profileKeys);
    const normalizedQuery = accountQuery?.trim().toLowerCase();
    return this.listProfiles()
      .filter(({ profileKey }) => allowed.has(profileKey))
      .map(({ profileKey }) => {
        const runtime = this.scriptHandler.getRuntimeByKey(profileKey)!;
        const accounts = this.listAccounts(runtime.profileId);
        const matches = normalizedQuery
          ? accounts.filter(({ username }) => username.toLowerCase().includes(normalizedQuery))
          : undefined;
        return {
          profileKey,
          accountCount: accounts.length,
          ...(matches ? {
            accountMatches: {
              query: accountQuery,
              accounts: matches.slice(0, 100).map(({ username }) => ({ account: username })),
              total: matches.length,
              truncated: matches.length > 100,
            },
          } : {}),
          bots: this.listBots(runtime.profileId).map((bot) => ({
            target: { profileKey, account: bot.username },
            status: bot.status,
            version: bot.version,
            host: bot.host,
            port: bot.port,
          })),
          activeRuns: this.listActiveRuns(runtime.profileId).map((run) => ({
            runId: run.id ?? run.instanceId,
            name: run.name ?? run.scriptName,
            status: run.status,
          })),
        };
      });
  }

  target(target: McpBotTarget): BotTarget {
    const runtime = this.scriptHandler.getRuntimeByKey(target.profileKey);
    if (!runtime) throw new Error('Profile is not currently available.');
    const matching = runtime.activeBots
      .toArray()
      .filter(
        (bot) =>
          bot.botId >= 0 &&
          bot.origin !== 'minecraft' &&
          bot.username.toLowerCase() === target.account.trim().toLowerCase(),
      );
    if (matching.length > 1)
      throw new Error('ambiguous_target: multiple bots use this account.');
    const bot = matching[0];
    if (!bot) throw new Error('Bot not found or no longer active.');
    return { profileId: runtime.profileId, botId: bot.botId };
  }

  async joinLogical(
    clientId: string,
    target: McpBotTarget,
    input: { version?: string; login?: boolean; gamemode?: string },
  ) {
    const runtime = this.scriptHandler.getRuntimeByKey(target.profileKey);
    if (!runtime) throw new Error('Profile is not currently available.');
    const existing = runtime.activeBots
      .toArray()
      .filter(
        (bot) =>
          bot.botId >= 0 &&
          bot.origin !== 'minecraft' &&
          bot.username.toLowerCase() === target.account.trim().toLowerCase(),
      );
    if (existing.length > 1)
      throw new Error('ambiguous_target: multiple bots use this account.');
    if (existing.length === 1)
      return { target, state: existing[0].status, alreadyActive: true };
    const result = await this.joinBot(clientId, runtime.profileId, {
      username: target.account,
      ...input,
    });
    return { target, state: result.state, alreadyActive: false };
  }

  action(target: McpBotTarget, actionId: string, inputs: Record<string, unknown>) {
    return this.executeRecipeAction(this.target(target), actionId, inputs);
  }

  state(target: McpBotTarget) {
    return this.getBotState(this.target(target));
  }

  chat(target: McpBotTarget, input: Record<string, unknown>) {
    return this.getBotChat(this.target(target), input);
  }

  inventory(target: McpBotTarget) {
    return this.getBotInventory(this.target(target));
  }

  players(target: McpBotTarget) {
    return this.getBotPlayers(this.target(target));
  }

  entities(target: McpBotTarget, input: Record<string, unknown>) {
    return this.getNearbyEntities(this.target(target), input);
  }

  block(target: McpBotTarget, input: Record<string, unknown>) {
    return this.getBlockAt(this.target(target), input);
  }

  find(target: McpBotTarget, input: Record<string, unknown>) {
    return this.findBlocks(this.target(target), input);
  }

  script(target: McpBotTarget, code: string, timeoutMs: number) {
    return this.runCode(this.target(target), code, timeoutMs);
  }

  events(target: McpBotTarget, input: Record<string, unknown>) {
    return this.request(this.target(target), 'mcpGetEvents', input);
  }

  wait(target: McpBotTarget, input: Record<string, unknown>) {
    return this.request(this.target(target), 'mcpWaitForEvent', input);
  }

  /** Account names of every active bot in a profile, for `accounts: ['*']`. */
  activeAccounts(profileKey: string): string[] {
    const runtime = this.scriptHandler.getRuntimeByKey(profileKey);
    return runtime ? this.listBots(runtime.profileId).map((bot) => bot.username) : [];
  }

  async getBotState(target: BotTarget) {
    return this.request(target, 'mcpGetState');
  }

  async getBotChat(target: BotTarget, input: Record<string, unknown>) {
    return this.request(target, 'mcpGetChat', input);
  }

  async getBotInventory(target: BotTarget) {
    return this.request(target, 'mcpGetInventory');
  }

  async getBotPlayers(target: BotTarget) {
    return this.request(target, 'mcpGetPlayers');
  }

  async getNearbyEntities(target: BotTarget, input: Record<string, unknown>) {
    return this.request(target, 'mcpGetNearbyEntities', input);
  }

  async getBlockAt(target: BotTarget, input: Record<string, unknown>) {
    return this.request(target, 'mcpGetBlockAt', input);
  }

  async findBlocks(target: BotTarget, input: Record<string, unknown>) {
    return this.request(target, 'mcpFindBlocks', input);
  }

  async executeRecipeAction(
    target: BotTarget,
    actionId: string,
    inputs: Record<string, unknown>,
  ) {
    return this.serialized(target, () =>
      this.request(target, 'mcpRecipeAction', { actionId, inputs }),
    );
  }

  async runCode(target: BotTarget, code: string, timeoutMs: number) {
    return this.serialized(target, () =>
      this.request(target, 'mcpRunCode', { code, timeoutMs }),
    );
  }

  async runPluginAction(
    target: BotTarget,
    pluginId: string,
    args: unknown[],
    optionOverrides: Record<string, unknown>,
  ) {
    return this.serialized(target, () =>
      this.request(target, 'mcpRunPluginAction', {
        id: pluginId,
        arg: args,
        optionOverrides,
      }),
    );
  }

  async joinBot(
    clientId: string,
    profileId: number,
    input: {
      username: string;
      version?: string;
      login?: boolean;
      gamemode?: string;
    },
  ) {
    const session = await this.getSession(clientId, profileId);
    const key = this.joinKey(clientId, profileId, input.username);
    const optionsKey = JSON.stringify({
      username: input.username.toLowerCase(),
      version: input.version ?? '1.8.9',
      login: input.login ?? true,
      gamemode: input.gamemode ?? null,
    });
    const existingId = this.joinsByAccount.get(key);
    if (existingId) {
      const existing = this.joinAttempts.get(existingId);
      if (existing) {
        this.refreshJoinAttempt(existing);
        if (existing.state !== 'failed') {
          if (existing.optionsKey !== optionsKey)
            throw new Error(
              'This account already has an MCP join with different options.',
            );
          return this.joinSnapshot(existing);
        }
        this.joinAttempts.delete(existing.joinId);
      }
      this.joinsByAccount.delete(key);
    }

    const attempt: JoinAttempt = {
      joinId: randomUUID(),
      key,
      clientId,
      profileId,
      username: input.username,
      optionsKey,
      sessionId: session.instanceId,
      state: 'queued',
      updatedAt: Date.now(),
      completion: Promise.resolve(),
    };
    this.joinAttempts.set(attempt.joinId, attempt);
    this.joinsByAccount.set(key, attempt.joinId);
    attempt.completion = backendMessaging.messenger
      .request<{
        botId: number;
        username: string;
        version: string;
        status: string;
      }>('MCP_JOIN', session.messagingAddress, input, { timeoutMs: 0 })
      .then((result) => {
        attempt.botId = result.botId;
        attempt.state = 'connected';
        attempt.settled = true;
        attempt.updatedAt = Date.now();
      })
      .catch((error) => {
        attempt.state = 'failed';
        attempt.settled = true;
        attempt.error = error instanceof Error ? error.message : String(error);
        attempt.updatedAt = Date.now();
      });
    await this.waitForJoinChange(attempt, 750);
    return this.joinSnapshot(attempt);
  }

  async getJoinStatus(
    clientId: string,
    joinId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    const attempt = this.joinAttempts.get(joinId);
    if (!attempt || attempt.clientId !== clientId)
      throw new Error('Join attempt not found.');
    const initialState = attempt.state;
    const deadline = Date.now() + Math.max(0, Math.min(timeoutMs, 25_000));
    do {
      this.refreshJoinAttempt(attempt);
      if (
        attempt.state !== initialState ||
        attempt.state === 'connected' ||
        attempt.state === 'failed' ||
        signal?.aborted
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    if (signal?.aborted) throw signal.reason;
    return this.joinSnapshot(attempt);
  }

  async stopClientSessions(clientId?: string): Promise<void> {
    const sessions = [...this.sessions.entries()].filter(([key]) =>
      clientId ? key.startsWith(`${clientId}:`) : true,
    );
    await Promise.allSettled(
      sessions.map(async ([key, session]) => {
        this.sessions.delete(key);
        await Promise.race([
          session.stop(),
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ]);
      }),
    );
    for (const [joinId, attempt] of this.joinAttempts) {
      if (clientId && attempt.clientId !== clientId) continue;
      this.joinAttempts.delete(joinId);
      this.joinsByAccount.delete(attempt.key);
    }
    for (const key of this.startingSessions.keys())
      if (!clientId || key.startsWith(`${clientId}:`))
        this.startingSessions.delete(key);
  }

  emergencyStop(): void {
    for (const runtime of this.scriptHandler.getRuntimeSummaries()) {
      const profile = this.scriptHandler.getRuntimeByKey(runtime.profileKey)!;
      for (const bot of this.listBots(profile.profileId)) {
        const active = this.scriptHandler
          .getRuntime(profile.profileId)
          .activeBots.getBot(bot.botId);
        active
          ?.requestAction('mcpRecipeAction', {
            actionId: 'botClearMovement',
            inputs: {},
          })
          .catch(() => undefined);
      }
    }
    void this.stopClientSessions();
    this.queues.clear();
  }

  private async getSession(
    clientId: string,
    profileId: number,
  ): Promise<Script> {
    const key = `${clientId}:${profileId}`;
    const existing = this.sessions.get(key);
    if (
      existing?.worker &&
      this.scriptHandler
        .getRuntime(profileId)
        .activeScripts.getScript(existing.instanceId) === existing
    )
      return existing;
    const starting = this.startingSessions.get(key);
    if (starting) return starting;
    const promise = (async () => {
      const scriptId = `mcp-session-${clientId}`;
      await this.scriptHandler.runScript(profileId, {
        script: 'mcpSession',
        scriptId,
        arguments: { mcpClientId: clientId },
      });
      const session = this.scriptHandler
        .getRuntime(profileId)
        .activeScripts.getScriptsByScriptId(scriptId)
        .at(-1);
      if (!session) throw new Error('Could not start the MCP bot session.');
      this.sessions.set(key, session);
      return session;
    })().finally(() => {
      this.startingSessions.delete(key);
    });
    this.startingSessions.set(key, promise);
    return promise;
  }

  private joinKey(clientId: string, profileId: number, username: string) {
    return `${clientId}:${profileId}:${username.trim().toLowerCase()}`;
  }

  private refreshJoinAttempt(attempt: JoinAttempt): void {
    const bot = this.scriptHandler
      .getRuntime(attempt.profileId)
      .activeBots.toArray()
      .find(
        (candidate) =>
          (candidate.RUNTIME_SCRIPT_ID === attempt.sessionId ||
            candidate.INSTANCE_ID === `mcpSession-${attempt.sessionId}`) &&
          candidate.username.toLowerCase() === attempt.username.toLowerCase(),
      );
    if (!bot) {
      if (attempt.state === 'connected' && attempt.observedBot) {
        attempt.state = 'failed';
        attempt.error = 'Bot disconnected.';
        attempt.updatedAt = Date.now();
      }
      return;
    }
    attempt.observedBot = true;
    attempt.botId = bot.botId;
    const nextState: JoinState =
      bot.status === 'connected'
        ? 'connected'
        : bot.status === 'failed' && attempt.settled
          ? 'failed'
          : bot.status === 'joining'
            ? 'joining'
            : 'queued';
    if (nextState !== attempt.state) {
      attempt.state = nextState;
      attempt.updatedAt = Date.now();
    }
  }

  private async waitForJoinChange(
    attempt: JoinAttempt,
    timeoutMs: number,
  ): Promise<void> {
    const initialState = attempt.state;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.refreshJoinAttempt(attempt);
      if (attempt.state !== initialState || attempt.botId) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private joinSnapshot(attempt: JoinAttempt) {
    return {
      joinId: attempt.joinId,
      state: attempt.state,
      profileId: attempt.profileId,
      username: attempt.username,
      botId: attempt.botId,
      error: attempt.error,
      updatedAt: attempt.updatedAt,
    };
  }

  private requiredBot(target: BotTarget): Bot {
    const bot = this.scriptHandler
      .getRuntime(target.profileId)
      .activeBots.getBot(target.botId);
    if (!bot) throw new Error('Bot not found or no longer active.');
    return bot;
  }

  private request(target: BotTarget, action: string, data?: unknown) {
    return this.requiredBot(target).requestAction(action, data);
  }

  private serialized<T>(target: BotTarget, task: () => Promise<T>): Promise<T> {
    const key = `${target.profileId}:${target.botId}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task);
    // The queue entry never rejects; the caller handles `next`'s error.
    const tracked = next.catch(() => undefined).finally(() => {
      if (this.queues.get(key) === tracked) this.queues.delete(key);
    });
    this.queues.set(key, tracked);
    return next;
  }
}

export default McpBotBridge;
