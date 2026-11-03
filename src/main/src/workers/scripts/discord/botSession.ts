import type { APISelectMenuOption } from 'discord.js';
import type {
  Bot,
  BotEventMap,
  InventoryPacket,
} from '../../workerTypes';
import type { SendableChannel } from './types';
import { ansiBlock, embed, stripAnsi } from './util';
import { chatToDiscordAnsi, stringifyReason } from './mcChat';

/* ------------------------------------------------------------------ */
/*  Event log categories                                              */
/* ------------------------------------------------------------------ */

export type LogCategory = 'chat' | 'kick' | 'death' | 'window' | 'move' | 'system';

export const LOG_CATEGORY_INFO: Record<
  LogCategory,
  { label: string; description: string; emoji: string }
> = {
  chat: { label: 'Chat', description: 'Stream in-game chat (coloured)', emoji: '💬' },
  kick: { label: 'Kicks', description: 'When the bot is kicked', emoji: '🚫' },
  death: { label: 'Deaths', description: 'When the bot dies', emoji: '💀' },
  window: { label: 'Windows', description: 'When a window/GUI opens', emoji: '🪟' },
  move: { label: 'Movement', description: 'Block-position changes (throttled)', emoji: '🚶' },
  system: { label: 'System', description: 'Spawns and disconnects', emoji: '⚙️' },
};

export const LOG_CATEGORIES = Object.keys(LOG_CATEGORY_INFO) as LogCategory[];

/** Sensible defaults: everything informative except the spammy ones. */
const DEFAULT_CATEGORIES: readonly LogCategory[] = ['kick', 'death', 'window', 'system'];

/* ------------------------------------------------------------------ */
/*  Tuning                                                            */
/* ------------------------------------------------------------------ */

const CHAT_HISTORY = 40;
const FLUSH_INTERVAL_MS = 1500;
const MOVE_LOG_INTERVAL_MS = 5000;
/** Stay well under Discord's 2000-char message limit (code-block fences cost). */
const MAX_CHAT_BLOCK = 1800;

export interface BotInfoSnapshot {
  username: string;
  online: boolean;
  gamemode: string;
  health: number | null;
  food: number | null;
  level: number | null;
  position: { x: number; y: number; z: number } | null;
  ping: number | null;
  version: string;
  windowTitle: string | null;
  uptimeMs: number;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * Wraps a single mineflayer bot that was spawned inside the Discord worker.
 * Owns the bot's event → Discord-channel logging and exposes typed control
 * methods used by the slash commands and component interactions.
 */
export class BotSession {
  readonly bot: Bot;
  readonly botId: number;
  readonly username: string;
  readonly joinedAt = Date.now();

  private channel: SendableChannel | null = null;
  private readonly categories = new Set<LogCategory>(DEFAULT_CATEGORIES);
  private readonly recentChat: string[] = [];
  private readonly pendingChat: string[] = [];
  private readonly pendingEvents: string[] = [];
  private readonly cleanups: Array<() => void> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMoveLogAt = 0;
  private lastBlock = '';
  private disposed = false;

  constructor(bot: Bot, private readonly onEnd: (session: BotSession) => void) {
    this.bot = bot;
    this.botId = bot.botId;
    this.username = bot.username;
    this.wireEvents();
  }

  /* ---------------- Lifecycle ---------------- */

  private listen<E extends keyof BotEventMap>(event: E, handler: BotEventMap[E]): void {
    this.bot.on(event, handler);
    this.cleanups.push(() => this.bot.removeListener(event, handler));
  }

  private wireEvents(): void {
    this.listen('message', (message, position) => {
      if (position === 'game_info') return;
      this.logChat(chatToDiscordAnsi(message));
    });

    this.listen('kicked', (reason) => {
      this.logEvent('kick', `🚫 Kicked: ${stripAnsi(stringifyReason(reason))}`);
    });

    this.listen('death', () => {
      this.logEvent('death', '💀 The bot died');
    });

    this.listen('spawn', () => {
      this.logEvent('system', '✅ Spawned in the world');
    });

    this.listen('windowOpen', () => {
      const title = stripAnsi(safe(() => this.bot.getWindowTitle()) ?? 'Window');
      this.logEvent('window', `🪟 Window opened: ${title || 'Untitled'}`);
    });

    this.listen('move', () => {
      if (!this.categories.has('move')) return;
      const now = Date.now();
      if (now - this.lastMoveLogAt < MOVE_LOG_INTERVAL_MS) return;
      const pos = this.bot.entity?.position;
      if (!pos) return;
      const block = `${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`;
      if (block === this.lastBlock) return;
      this.lastBlock = block;
      this.lastMoveLogAt = now;
      this.logEvent('move', `🚶 Moved to \`${block}\``);
    });

    this.listen('end', () => {
      this.logEvent('system', '🔌 Disconnected from the server');
      this.onEnd(this);
    });
  }

  /** Flush remaining logs, drop listeners and timers. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.flushNow();
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }

  /* ---------------- Logging ---------------- */

  /** Point this session's event stream at a Discord channel. */
  attachChannel(channel: SendableChannel): void {
    this.channel = channel;
  }

  getCategories(): Set<LogCategory> {
    return new Set(this.categories);
  }

  setCategories(categories: LogCategory[]): void {
    this.categories.clear();
    for (const c of categories) {
      if (LOG_CATEGORIES.includes(c)) this.categories.add(c);
    }
  }

  /** Options for the log-toggle select menu, pre-selecting the active ones. */
  categoryOptions(): APISelectMenuOption[] {
    return LOG_CATEGORIES.map((c) => ({
      label: LOG_CATEGORY_INFO[c].label,
      value: c,
      description: LOG_CATEGORY_INFO[c].description,
      emoji: { name: LOG_CATEGORY_INFO[c].emoji },
      default: this.categories.has(c),
    }));
  }

  /** Recent chat as a Discord ANSI block, or null when nothing was captured. */
  recentChatBlock(): string | null {
    if (this.recentChat.length === 0) return null;
    return ansiBlock(this.fit(this.recentChat));
  }

  private logChat(ansiLine: string): void {
    this.recentChat.push(ansiLine);
    if (this.recentChat.length > CHAT_HISTORY) this.recentChat.shift();
    if (this.categories.has('chat')) {
      this.pendingChat.push(ansiLine);
      this.scheduleFlush();
    }
  }

  private logEvent(category: LogCategory, line: string): void {
    if (!this.categories.has(category)) return;
    this.pendingEvents.push(line);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.disposed || !this.channel || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, FLUSH_INTERVAL_MS);
  }

  private flushNow(): void {
    const channel = this.channel;
    if (!channel) {
      this.pendingChat.length = 0;
      this.pendingEvents.length = 0;
      return;
    }
    if (this.pendingChat.length > 0) {
      const block = ansiBlock(this.fit(this.pendingChat));
      this.pendingChat.length = 0;
      void channel.send({ content: block }).catch(() => undefined);
    }
    if (this.pendingEvents.length > 0) {
      const events = this.pendingEvents.splice(0).join('\n');
      void channel
        .send({ embeds: [embed(`📋 ${this.username}`, events, 'info')] })
        .catch(() => undefined);
    }
  }

  /** Keep only the most recent lines that fit inside one ANSI block. */
  private fit(lines: string[]): string {
    let out = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      const next = lines[i] + (out ? '\n' + out : '');
      if (next.length > MAX_CHAT_BLOCK) break;
      out = next;
    }
    return out || lines[lines.length - 1].slice(0, MAX_CHAT_BLOCK);
  }

  /* ---------------- Control ---------------- */

  sendChat(message: string): void {
    this.bot.actions.chatMessage(message);
  }

  getInventory(): InventoryPacket | { items: [] } | undefined {
    return this.bot.actions.sendInventoryPacket();
  }

  clickSlot(slot: number, button = 0, mode = 0): void {
    this.bot.actions.inventoryClick({ slot, button, mode });
  }

  closeWindow(): void {
    this.bot.actions.closeWindow();
  }

  login(): void {
    void this.bot.actions.login();
  }

  disconnect(): void {
    this.bot.actions.leave();
  }

  info(): BotInfoSnapshot {
    const bot = this.bot;
    const pos = bot.entity?.position;
    return {
      username: bot.username,
      online: safe(() => bot.isOnline()) ?? true,
      gamemode: safe(() => bot.getGamemode()) ?? '?',
      health: typeof bot.health === 'number' ? Math.round(bot.health) : null,
      food: typeof bot.food === 'number' ? Math.round(bot.food) : null,
      level: bot.experience?.level ?? null,
      position: pos
        ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }
        : null,
      ping: bot.player?.ping ?? null,
      version: bot.version ?? '?',
      windowTitle: bot.currentWindow
        ? stripAnsi(safe(() => bot.getWindowTitle()) ?? '')
        : null,
      uptimeMs: Date.now() - this.joinedAt,
    };
  }
}
