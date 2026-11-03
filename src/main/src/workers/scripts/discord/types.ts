import type {
  AutocompleteInteraction,
  BaseMessageOptions,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import type { BotManager } from './botManager';

export type ActivityLevel = 'info' | 'success' | 'warn' | 'error';

// The bridge payloads are shared across the worker boundary — see
// `workerScript.getPlugins/getProfileScripts/getLogs`. Re-exported here under
// the names the Discord handlers already use.
export type {
  PluginSummary as DiscordPlugin,
  ProfileScriptSummary,
  WorkerLogEntry as DiscordLogEntry,
} from '../../../types';

/**
 * A Discord channel we can post bot event logs into. discord.js' channel
 * unions don't expose a single "sendable" type in this version, so we narrow
 * to the one method we use. {@link isSendableChannel} produces this safely.
 */
export interface SendableChannel {
  send(options: string | BaseMessageOptions): Promise<unknown>;
}

/**
 * Everything a command / interaction handler needs. Passed by value so handlers
 * never reach for module-level singletons or `global`.
 */
export interface BotContext {
  client: Client;
  commands: DiscordCommand[];
  /** In-worker Minecraft bots spawned via `/join`. */
  bots: BotManager;
  /** Emit a live-activity event to the renderer Discord page. */
  activity: (kind: string, message: string, level?: ActivityLevel) => void;
}

export type CommandHandler = (
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
) => Promise<void>;

export type AutocompleteHandler = (
  interaction: AutocompleteInteraction,
  ctx: BotContext,
) => Promise<void>;

export interface DiscordCommand {
  data: ReturnType<SlashCommandBuilder['toJSON']>;
  execute: CommandHandler;
  autocomplete?: AutocompleteHandler;
}

/** Union of the component interactions the router dispatches on. */
export type ComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;
