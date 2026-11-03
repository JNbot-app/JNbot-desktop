import type { AltCredentials, JoinConfig } from 'common/types/pluginApi';
import type { Bot } from '../workerTypes';
import {
  getKickAction,
  resolveKickAction,
  type KickDecision,
} from './controls/kickControl';
import { parseRawNbt } from './extensions/nbtParser';

export type BotSessionState = 'connecting' | 'online' | 'paused' | 'closed';



export type BotSessionSnapshot = {
  state: BotSessionState;
  bot: Bot | null;
};

export type BotSessionJoinOptions = JoinConfig & {
  joinGamemode?: boolean;
};

type Listener = (snapshot: BotSessionSnapshot) => void;

export type BotSessionOptions = {
  profile: AltCredentials;
  joinOptions?: BotSessionJoinOptions;
  reconnect?: boolean;
};

export default class BotSession {
  bot: Bot | null = null;
  state: BotSessionState = 'connecting';

  private readonly profile: AltCredentials;
  private readonly joinOptions: BotSessionJoinOptions;
  private readonly reconnect: boolean;
  private readonly listeners = new Set<Listener>();
  private readonly resumeWaiters = new Set<() => void>();

  private openPromise: Promise<Bot | null> | null = null;
  private attemptAbort: AbortController | null = null;
  private generation = 0;
  private disconnectedGeneration = 0;
  private readonly disconnectDecisions = new Map<
    number,
    Promise<KickDecision>
  >();

  constructor(options: BotSessionOptions) {
    this.profile = options.profile;
    this.joinOptions = options.joinOptions ?? {};
    this.reconnect = options.reconnect ?? true;
  }

  static adopt(bot: Bot, options: BotSessionOptions): BotSession {
    const session = new BotSession(options);
    session.attach(bot, true);
    return session;
  }

  private _proxy: Bot | null = null;

  get closed(): boolean {
    return this.state === 'closed';
  }

  get proxy(): Bot {
    if (!this._proxy) {
      this._proxy = new Proxy({} as Bot, {
        get: (_target, prop) => {
          if (prop === 'session') return this;
          const active = this.bot;
          if (active) {
            const value = Reflect.get(active, prop, active);
            if (typeof value === 'function') {
              return Object.assign(value.bind(active), value);
            }
            return value;
          }
          return undefined;
        },
        set: (_target, prop, value) => {
          const active = this.bot;
          if (active) {
            return Reflect.set(active, prop, value, active);
          }
          return true;
        },
        has: (_target, prop) => {
          if (prop === 'session') return true;
          return this.bot ? prop in this.bot : false;
        },
        ownKeys: () => {
          return this.bot ? Reflect.ownKeys(this.bot) : [];
        },
        getOwnPropertyDescriptor: (_target, prop) => {
          if (!this.bot) return undefined;
          const desc = Reflect.getOwnPropertyDescriptor(this.bot, prop);
          if (desc) {
            return { ...desc, configurable: true };
          }
          return undefined;
        },
        getPrototypeOf: () => {
          return this.bot ? Reflect.getPrototypeOf(this.bot) : Object.prototype;
        },
      });
    }
    return this._proxy;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.snapshot());
    } catch {
      // A subscriber cannot interrupt the session lifecycle.
    }
    return () => this.listeners.delete(listener);
  }

  open(): Promise<Bot | null> {
    if (this.closed) return Promise.resolve(null);
    if (this.bot?.isOnline?.()) return Promise.resolve(this.bot);
    if (this.openPromise) return this.openPromise;

    this.openPromise = this.connectLoop().finally(() => {
      this.openPromise = null;
      this.attemptAbort = null;
    });
    return this.openPromise;
  }

  pause(): void {
    if (this.closed || this.state === 'paused') return;
    this.state = 'paused';
    this.attemptAbort?.abort();
    this.emit();
  }

  resume(): void {
    if (this.closed || this.state !== 'paused') return;
    this.state = this.bot?.isOnline?.() ? 'online' : 'connecting';
    this.emit();
    this.releaseResumeWaiters();
    if (!this.bot?.isOnline?.()) void this.open();
  }

  close(): void {
    if (this.closed) return;
    this.state = 'closed';
    this.generation++;
    this.disconnectDecisions.clear();
    this.attemptAbort?.abort();
    this.releaseResumeWaiters();
    const bot = this.bot;
    this.bot = null;
    this.emit();
    try {
      bot?.end?.();
    } catch {
      // Ending a bot is best-effort; the session is already terminal.
    }
  }

  private async connectLoop(): Promise<Bot | null> {
    let failedJoins = 0;
    while (!this.closed) {
      await this.waitWhilePaused();
      if (this.closed) return null;

      this.state = 'connecting';
      this.emit();

      const generation = ++this.generation;
      const abort = (this.attemptAbort = new AbortController());
      let kickResolution: Promise<KickDecision> | null = null;

      const joinModule = require('./join');
      const joinFn = typeof joinModule === 'function' ? joinModule : joinModule.default;
      const bot = await joinFn(
        { ...this.profile },
        {
          ...this.joinOptions,
          retryOnLoginFail: false,
          signal: abort.signal,
          onKick: (reason: string) => {
            if (generation !== this.generation || this.closed) return;
            const resolution = this.handleKick(reason);
            if (this.bot) {
              this.disconnectDecisions.set(generation, resolution);
              void this.handleDisconnect(generation, resolution);
            } else {
              kickResolution = resolution;
            }
          },
        },
      );

      if (this.attemptAbort === abort) this.attemptAbort = null;
      if (generation !== this.generation || this.closed) {
        bot?.end?.();
        return null;
      }

      if (bot && kickResolution) {
        bot.end?.();
        const decision = await this.kickDecision(kickResolution);
        if (decision === 'skip') {
          this.close();
          return null;
        }
        continue;
      }

      if (bot) {
        this.attach(bot, false, generation);
        if (this.bot === bot) return bot;

        const decision = await this.kickDecision(
          this.disconnectDecisions.get(generation) ?? null,
        );
        this.disconnectDecisions.delete(generation);
        if (decision === 'skip' || !this.reconnect) {
          this.close();
          return null;
        }
        continue;
      }

      const decision = await this.kickDecision(kickResolution);
      if (decision === 'skip') {
        this.close();
        return null;
      }
      const maxFailedJoins =
        global.appSettings?.retryOnLoginFail === false ? 1 : 3;
      if (this.state !== 'paused' && ++failedJoins >= maxFailedJoins) {
        global.log(
          `[${this.profile.username}] skipped after ${failedJoins} failed joins`,
          'warning',
        );
        this.close();
        return null;
      }
    }
    return null;
  }

  private attach(
    bot: Bot,
    adopted: boolean,
    generation = ++this.generation,
  ): void {
    if (this.closed) {
      bot.end?.();
      return;
    }

    this.bot = bot;
    this.state = 'online';
    bot.session = this;

    if (adopted) {
      bot.once('kicked', (reason: unknown) => {
        if (generation !== this.generation || this.closed) return;
        const decision = this.handleKick(String(parseRawNbt(reason)));
        this.disconnectDecisions.set(generation, decision);
        void this.handleDisconnect(generation, decision);
      });
    }

    bot.once('end', () => {
      // Mineflayer may emit `end` synchronously while the lower-level kicked
      // handler is still notifying us. Give that callback one microtask to
      // install its pause/skip decision before treating this as a plain end.
      queueMicrotask(() => {
        if (generation !== this.generation || this.bot !== bot) return;
        const decision = this.disconnectDecisions.get(generation);
        if (decision) void this.handleDisconnect(generation, decision);
        else void this.handleDisconnect(generation);
      });
    });

    this.emit();
  }

  private async handleKick(reason: string): Promise<KickDecision> {
    const action = getKickAction(reason);
    if (action === 'pause') this.pause();
    const decision = await resolveKickAction(
      {
        username: String(this.profile.username),
        botId: this.bot?.botId ?? 0,
      },
      reason,
      action,
    );
    if (decision === 'retry' && this.state === 'paused') this.resume();
    return decision;
  }

  private async kickDecision(
    pending: Promise<KickDecision> | null,
  ): Promise<KickDecision> {
    return pending ? pending : 'retry';
  }

  private async handleDisconnect(
    generation: number,
    decision: Promise<KickDecision> = Promise.resolve('retry'),
  ): Promise<void> {
    if (
      generation !== this.generation ||
      this.disconnectedGeneration === generation ||
      this.closed
    ) {
      return;
    }

    this.disconnectedGeneration = generation;
    this.bot = null;
    const next = await decision;
    this.disconnectDecisions.delete(generation);

    if (generation !== this.generation || this.closed) return;
    if (next === 'skip' || !this.reconnect) {
      this.close();
      return;
    }

    if (this.state !== 'paused') {
      this.state = 'connecting';
      this.emit();
      this.scheduleOpen(generation);
    } else {
      this.emit();
    }
  }

  private scheduleOpen(generation: number): void {
    const pending = this.openPromise;
    if (!pending) {
      void this.open();
      return;
    }
    const reopen = () => {
      if (generation === this.generation && !this.closed && !this.bot) {
        void this.open();
      }
    };
    void pending.then(reopen, reopen);
  }

  private waitWhilePaused(): Promise<void> {
    if (this.state !== 'paused') return Promise.resolve();
    return new Promise((resolve) => this.resumeWaiters.add(resolve));
  }

  private releaseResumeWaiters(): void {
    for (const resolve of this.resumeWaiters) resolve();
    this.resumeWaiters.clear();
  }

  private snapshot(): BotSessionSnapshot {
    return { state: this.state, bot: this.bot };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A subscriber cannot interrupt the session lifecycle.
      }
    }
  }
}
