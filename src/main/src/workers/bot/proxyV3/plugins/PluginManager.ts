/**
 * Owns the per-connection plugins and routes `/jnbot <command>` chat input to
 * them. Commands are flat tokens such as `debug`, which suits
 * chat-only usage.
 *
 * Command input is recognized across protocol versions:
 *  - `chat` (<= 1.18): message includes the leading slash.
 *  - `chat_command` / `chat_command_signed` (1.19+): `command` field, no slash.
 */
import { PacketContext } from '../PacketPipeline';
import type { Session } from '../Session';
import type { Participant } from '../Participant';
import { Plugin, ICommand } from './Plugin';
import { CorePlugin } from './Core';
import { DebugPlugin } from './Recorder';

export type PluginConstructor = new (connection: Session) => Plugin;

const CHAT_PACKETS = [
  'chat',
  'chat_message',
  'chat_command',
  'chat_command_signed',
];

export class PluginManager {
  /** keyword that opens the proxy command space, without slash */
  readonly keyword = 'jnbot';
  readonly plugins = new Map<string, Plugin>();
  readonly commands = new Map<string, { plugin: Plugin; command: ICommand }>();

  constructor(readonly connection: Session) {}

  start(): void {
    this.enablePlugin(CorePlugin);
    this.enablePlugin(DebugPlugin);
    this.connection.pipeline.on(CHAT_PACKETS, (ctx) => this.#onChat(ctx));
  }

  stop(): void {
    for (const name of [...this.plugins.keys()]) this.disablePlugin(name);
  }

  getPlugin<T extends Plugin = Plugin>(name: string): T | undefined {
    return this.plugins.get(name) as T | undefined;
  }

  /** Create and start a plugin for this session. */
  enablePlugin<T extends Plugin = Plugin>(Ctor: new (connection: Session) => T): T {
    const plugin = new Ctor(this.connection);
    if (this.plugins.has(plugin.meta.name)) {
      throw new Error(`Plugin "${plugin.meta.name}" is already enabled`);
    }
    for (const command of plugin.meta.commands ?? []) {
      const key = command.name.toLowerCase();
      if (this.commands.has(key)) {
        console.warn(
          `[proxy] duplicate command "${key}" from plugin "${plugin.meta.name}"`,
        );
      }
      this.commands.set(key, { plugin, command });
    }
    plugin.start();
    this.plugins.set(plugin.meta.name, plugin);
    return plugin;
  }

  /** Stop and remove a plugin. Returns false when it was not enabled. */
  disablePlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    try {
      plugin.stop();
    } catch (error) {
      console.error(`[proxy] plugin "${plugin.meta.name}" stop error:`, error);
    }
    this.plugins.delete(name);
    for (const [commandName, entry] of this.commands) {
      if (entry.plugin === plugin) this.commands.delete(commandName);
    }
    return true;
  }

  #onChat(ctx: PacketContext): void {
    if (ctx.direction !== 'c2s') return;

    const raw = this.#extractCommand(ctx);
    if (raw === null) return;

    if (raw !== this.keyword && !raw.startsWith(`${this.keyword} `)) return;

    // it's ours — never let it reach the real server
    ctx.drop();

    const sender = this.connection.participants.get(ctx.sourceParticipantId ?? '');
    if (sender) this.#execute(raw.slice(this.keyword.length).trim(), sender);
  }

  #extractCommand(ctx: PacketContext): string | null {
    const { name, data } = ctx;
    if (name === 'chat' || name === 'chat_message') {
      const message = data?.message;
      if (typeof message !== 'string' || !message.startsWith('/')) return null;
      return message.slice(1).trim();
    }
    if (name === 'chat_command' || name === 'chat_command_signed') {
      const command = data?.command;
      return typeof command === 'string' ? command.trim() : null;
    }
    return null;
  }

  #execute(rest: string, sender: Participant): void {
    if (!rest) return this.#help(sender);

    const [name, ...args] = rest.split(/\s+/);
    const entry = this.commands.get(name.toLowerCase());
    if (!entry) {
      sender.tell(`§cUnknown command: §f${name}§c. Type §6/${this.keyword}§c for help.`);
      return;
    }
    try {
      entry.command.handler.call(entry.plugin, args, sender);
    } catch (error) {
      console.error(`[proxy] command "${name}" failed:`, error);
      sender.tell(`§cCommand failed: §f${(error as Error)?.message ?? error}`);
    }
  }

  #help(sender: Participant): void {
    sender.tell('§6§lJNbot Proxy §r§7— available commands:');
    for (const { command } of this.commands.values()) {
      if (command.hidden) continue;
      const usage = command.args?.length
        ? ` §7${command.args.map((a) => `<${a}>`).join(' ')}`
        : '';
      sender.tell(`§e/${this.keyword} ${command.name}${usage} §7- ${command.description}`);
    }
  }
}
