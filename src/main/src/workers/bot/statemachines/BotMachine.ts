import type { Bot } from 'main/src/workers/workerTypes';
import type {
  Action,
  AltCredentials,
  Awaitable,
  BotMachineControls,
  BotMachineOptions,
  Guard,
  JoinConfig,
  Task,
  TaskContext,
} from 'common/types/pluginApi';
import { gamemodeKey } from 'common/profiles';
import BotSession, {
  type BotSessionJoinOptions,
  type BotSessionSnapshot,
} from '../BotSession';
import joinGamemode, {
  gamemodeMatches,
  type JoinTargets,
} from './joinGamemode/joinGamemodeBehaviourV3';

export type {
  Action,
  AltCredentials,
  Awaitable,
  BotMachineOptions,
  Guard,
  JoinConfig,
  Task,
  TaskContext,
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);



export default class BotMachine<S extends object = Record<string, unknown>>
  implements BotMachineControls
{
  bot: Bot | null;
  state: S;
  delay: number;
  active = false;
  paused = false;

  private readonly tasks: Task<S>[] = [];
  private readonly finishListeners: Array<
    (data: { bot: Bot | null; state: S }) => void
  > = [];
  private readonly errorListeners: Array<
    (error: unknown, task: Task<S>, context: TaskContext<S>) => void
  > = [];

  private readonly joinConfig?: JoinConfig;
  private readonly stopWhenIdle: boolean;
  private readonly resetOnceOnRejoin: boolean;
  private readonly debug: boolean;
  private readonly options?: AltCredentials;
  private readonly finishOnDisconnect: boolean;

  private session: BotSession | null = null;
  private ownsSession = false;
  private unsubscribeSession?: () => void;
  private sessionClosed = false;
  private sessionPaused = false;
  private manuallyPaused = false;
  private botId?: number;
  private clockRunning = false;
  private lastBot: Bot | null;
  private hasConnectedBot: boolean;

  constructor(tasks: Task<S>[] = [], options: BotMachineOptions<S> = {}) {
    this.bot = options.bot ?? null;
    this.lastBot = this.bot;
    this.hasConnectedBot = Boolean(this.bot);
    this.state = options.state ?? ({} as S);
    this.delay =
      options.delay ??
      (global.appSettings?.delay_between_actions as number | undefined) ??
      250;
    this.joinConfig = options.join;
    this.stopWhenIdle = options.stopWhenIdle ?? false;
    this.resetOnceOnRejoin = options.resetOnceOnRejoin ?? true;
    this.debug = options.debug ?? true;
    this.finishOnDisconnect = options.disableAutoReconnect ?? false;
    this.botId = options.botId ?? this.bot?.botId;
    this.options =
      options.options ??
      (this.bot?.username ? { username: this.bot.username } : undefined);

    this.setupSession(options);
    this.addGamemodeTask();
    this.tasks.push(...tasks);
  }

  addTask(task: Task<S>): this {
    this.tasks.push(task);
    return this;
  }

  addTasks(tasks: Task<S>[]): this {
    this.tasks.push(...tasks);
    return this;
  }

  once(when: Guard<S>, run: Action<S>, name?: string): this {
    return this.addTask({ when, run, name, once: true });
  }

  setState(patch: Partial<S>): this {
    Object.assign(this.state, patch);
    return this;
  }

  getState(): S {
    return this.state;
  }

  setDelay(ms: number): this {
    this.delay = Math.max(0, ms);
    return this;
  }

  resetOnce(): this {
    this.tasks.forEach((task) => {
      task._done = false;
    });
    return this;
  }

  start(): this {
    if (this.active) return this;
    this.active = true;
    this.manuallyPaused = false;
    this.syncPaused();

    if (this.sessionClosed) {
      this.finish();
      return this;
    }

    if (this.finishOnDisconnect && this.session && !this.bot) {
      this.finish();
      return this;
    }

    if (this.session && !this.bot?.isOnline?.()) {
      void this.openSession();
    } else {
      void this.clock();
    }
    return this;
  }

  pause(botId = this.botId): this {
    this.manuallyPaused = true;
    this.syncPaused(botId);
    return this;
  }

  resume(botId = this.botId): this {
    this.manuallyPaused = false;
    this.syncPaused(botId);
    return this;
  }

  stop(): this {
    try {
      this.finish();
    } finally {
      if (this.ownsSession) this.session?.close();
    }
    return this;
  }

  finish(): this {
    if (!this.active) return this;
    this.active = false;
    this.paused = false;
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    const data = { bot: this.bot ?? this.lastBot, state: this.state };
    this.finishListeners.forEach((listener) => listener(data));
    return this;
  }

  interrupt(reason?: string): this {
    if (reason) this.log(`interrupted: ${reason}`, 'warning');
    return this.finish();
  }

  onFinish(listener: (data: { bot: Bot | null; state: S }) => void): this {
    if (typeof listener === 'function') this.finishListeners.push(listener);
    return this;
  }

  onError(
    listener: (error: unknown, task: Task<S>, context: TaskContext<S>) => void,
  ): this {
    if (typeof listener === 'function') this.errorListeners.push(listener);
    return this;
  }

  private setupSession(options: BotMachineOptions<S>): void {
    const existing = options.bot?.session ?? null;
    const credentials  = this.options;

    if (existing) {
      this.session = existing;
    } else if (!options.bot && credentials) {
      this.session = new BotSession({
        profile: credentials,
        joinOptions: this.sessionJoinOptions(),
        reconnect: !options.disableAutoReconnect,
      });
      this.ownsSession = true;
    }

    if (this.session) {
      this.unsubscribeSession = this.session.subscribe((snapshot) =>
        this.onSession(snapshot),
      );
    }
  }

  private sessionJoinOptions(): BotSessionJoinOptions {
    return {
      joinGamemode: false,
      gamemode: this.joinConfig?.gamemode,
      login: false,
      ...(this.joinConfig ?? {}),
    };
  }

  private onSession(snapshot: BotSessionSnapshot): void {
    this.sessionClosed = snapshot.state === 'closed';
    this.sessionPaused = snapshot.state === 'paused';

    if (snapshot.bot && snapshot.bot !== this.bot) {
      this.adoptBot(snapshot.bot);
    } else if (!snapshot.bot) {
      this.bot = null;
    }

    if (this.active) {
      this.syncPaused();
      if (
        this.sessionClosed ||
        (this.finishOnDisconnect && this.hasConnectedBot && !snapshot.bot)
      ) {
        this.finish();
      }
    }
  }

  private async openSession(): Promise<void> {
    const bot = await this.session!.open();
    if (!this.active) return;
    if (!bot) {
      if (this.session?.closed) this.finish();
      return;
    }
    if (bot !== this.bot) this.adoptBot(bot);
    void this.clock();
  }

  private addGamemodeTask(): void {
    if (!this.joinConfig?.gamemode) return;
    const target = gamemodeKey(this.joinConfig.gamemode);
    const maxRetries = 3;
    this.tasks.push({
      name: `Joining ${target} gamemode`,
      when: ({ bot, state }) =>
        !(state as JoinTargets).__join_done &&
        !gamemodeMatches(bot?.getGamemode(), target),
      run: async ({ bot, state }) => {
        const joinState = state as JoinTargets & { __join_relogs?: number };
        try {
          await joinGamemode(bot, this.joinConfig!.gamemode!);
          if (
            this.joinConfig?.optimisticJoin ||
            global.appSettings?.optimistic_join_gamemode
          ) {
            joinState.__join_done = true;
          }
          joinState.__join_relogs = 0;
        } catch (error) {
          joinState.__join_relogs = (joinState.__join_relogs ?? 0) + 1;
          if (joinState.__join_relogs > maxRetries) {
            this.log(
              `failed to join "${target}" gamemode after ${maxRetries} relogs`,
              'error',
            );
            this.finish();
            return;
          }

          if (bot?.isOnline?.() && this.session && !this.finishOnDisconnect) {
            this.log(
              `relogging after failed join gamemode task (attempt ${joinState.__join_relogs}/${maxRetries})`,
              'warning',
            );
            bot.end?.();
          }
          return;
        }
      },
    });
  }

  private adoptBot(bot: Bot): void {
    this.bot = bot;
    this.lastBot = bot;
    this.hasConnectedBot = true;
    this.botId = bot.botId;
    if (this.resetOnceOnRejoin) this.resetOnce();
    if (this.joinConfig?.gamemode) this.resetGamemodeState();
  }

  private resetGamemodeState(): void {
    const state = this.state as unknown as JoinTargets;
    state.__join_data = undefined;
    state.__join_events = undefined;
    state.__join_timeouts = undefined;
    state.__join_done = undefined;
  }

  private syncPaused(botId = this.botId): void {
    const paused = this.manuallyPaused || this.sessionPaused;
    if (paused === this.paused) return;
    this.paused = paused;
    if (botId) {
      global.send('BOT_STATUS_UPDATE', {
        botId,
        status: paused ? 'paused' : 'resumed',
      });
    }
  }

  private async clock(): Promise<void> {
    if (this.clockRunning) return;
    this.clockRunning = true;
    try {
      while (this.active) {
        if (!this.paused && this.bot?.isOnline?.()) {
          const ran = await this.tick();
          if (!ran && this.stopWhenIdle) {
            this.finish();
            break;
          }
        }
        await sleep(this.delay);
      }
    } finally {
      this.clockRunning = false;
    }
  }

  private async tick(): Promise<boolean> {
    const context = {
      bot: this.bot as Bot,
      state: this.state,
      machine: this,
    };

    for (const task of this.tasks) {
      if (task._done) continue;

      let matched = false;
      try {
        matched = task.when(context);
      } catch (error) {
        this.handleError(error, task, context);
        continue;
      }
      if (!matched) continue;

      if (this.debug && task.name) this.log(task.name);
      if (task.once) task._done = true;

      try {
        await task.run(context);
      } catch (error) {
        this.handleError(error, task, context);
      }
      return true;
    }
    return false;
  }

  private handleError(
    error: unknown,
    task: Task<S>,
    context: TaskContext<S>,
  ): void {
    if (this.errorListeners.length) {
      this.errorListeners.forEach((listener) => listener(error, task, context));
      return;
    }
    this.log(
      `task "${task.name ?? '?'}" failed: ${errorMessage(error)}`,
      'error',
    );
    throw error;
  }

  private get label(): string {
    return (
      this.options?.username ??
      this.bot?.username ??
      this.lastBot?.username ??
      'bot'
    );
  }

  private log(
    message: string,
    level?: 'info' | 'warning' | 'error' | 'success',
  ): void {
    global.log(`[${this.label}] ${message}`, level);
  }
}
