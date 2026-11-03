import type { Bot } from '../../workerTypes';
import { BotSession } from './botSession';

/** Account/connection options forwarded to the underlying `join()`. */
interface JoinProfile {
  username: string;
  version?: string;
  host?: string;
  port?: number;
}

/** The subset of `join.js`'s scriptOptions we set. */
interface JoinScriptOptions {
  stopOnEnd?: boolean;
  gamemode?: string | null;
  login?: boolean;
  joinGamemode?: boolean;
  retryOnLoginFail?: boolean;
  verbose?: boolean;
}

type JoinServerFn = (
  options: JoinProfile,
  scriptOptions?: JoinScriptOptions,
) => Promise<Bot | null>;

// join.js is the shared, battle-tested join path (proxies, auth, IP rotation,
// V4Guard, …). Reusing it keeps Discord bots identical to script-spawned ones.
const joinServer = require('../../bot/join') as JoinServerFn;

export interface JoinRequest {
  username: string;
  version?: string;
  gamemode?: string | null;
  login?: boolean;
}

/**
 * Owns every Minecraft bot spawned by `/join` inside the Discord worker. Bots
 * live here for their whole lifetime so slash commands and component
 * interactions can drive them directly — no cross-worker hops.
 */
export class BotManager {
  private readonly sessions = new Map<number, BotSession>();

  async join(req: JoinRequest): Promise<BotSession> {
    const bot = await joinServer(
      { username: req.username, version: req.version },
      {
        // Critical: never let a bot ending exit the Discord worker.
        stopOnEnd: false,
        login: req.login ?? false,
        gamemode: req.gamemode ?? null,
        joinGamemode: Boolean(req.gamemode),
        retryOnLoginFail: false,
      },
    );

    if (!bot) {
      throw new Error(`Failed to join as ${req.username}`);
    }

    // Guard against a stale entry reusing the same botId.
    this.remove(bot.botId);

    const session = new BotSession(bot, (ended) => this.remove(ended.botId));
    this.sessions.set(session.botId, session);
    return session;
  }

  /** Look up a session by numeric botId or by (case-insensitive) username. */
  get(idOrName: string | number): BotSession | undefined {
    if (typeof idOrName === 'number') return this.sessions.get(idOrName);

    const asId = Number(idOrName);
    if (Number.isFinite(asId) && this.sessions.has(asId)) {
      return this.sessions.get(asId);
    }
    const name = idOrName.toLowerCase();
    return this.list().find((s) => s.username.toLowerCase() === name);
  }

  /**
   * Resolve a command target: the explicitly named bot, or — when omitted —
   * the most recently joined one (the common single-bot case).
   */
  resolve(idOrName?: string | null): BotSession | undefined {
    if (idOrName) return this.get(idOrName);
    const all = this.list();
    return all[all.length - 1];
  }

  list(): BotSession[] {
    return [...this.sessions.values()];
  }

  remove(botId: number): void {
    const session = this.sessions.get(botId);
    if (!session) return;
    this.sessions.delete(botId);
    session.dispose();
  }

  disposeAll(): void {
    for (const session of this.list()) {
      session.disconnect();
      this.remove(session.botId);
    }
  }
}
