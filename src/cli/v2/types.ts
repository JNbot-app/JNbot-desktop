import type { MacroInfo } from '../../main/src/types';
import type ScriptHandler from '../../main/src/functions/ScriptHandler';

export type CliSeverity = 'debug' | 'info' | 'success' | 'warn' | 'error';

export interface OutputEvent {
  timestamp: number;
  severity: CliSeverity;
  source: string;
  message: string;
  stack?: string;
}

export interface CliResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: 1 | 2 | 130;
}

export interface CliRuntime {
  handler: ScriptHandler;
  close(): Promise<void>;
}

export interface CliAction<T = unknown> {
  id: string;
  description: string;
  execute(runtime: CliRuntime): Promise<CliResult<T>>;
}

export type Screen =
  | 'dashboard'
  | 'scripts'
  | 'bots'
  | 'logs'
  | 'profiles'
  | 'alts'
  | 'remote'
  | 'help'
  | 'result';

export type RunItem = {
  id: string;
  name: string;
  type: 'script' | 'plugin';
  detail: string;
  author?: string;
  config?: any;
};

export type RunnableScript = { info: MacroInfo; profileScriptId?: string };

export interface CooldownInfo {
  kind?: 'schedule';
  repeat?: import('../../common/cooldowns').ScheduleRepeat;
  id: string;
  pluginId: string;
  name: string;
  cooldown: number;
  time: number;
  autoStart: boolean;
  remainingMs: number;
  remainingFormatted: string;
  ready: boolean;
}

export interface BotDetails {
  botId: number;
  username: string;
  server: string;
  script: string;
  status: string;
  health?: number | null;
  food?: number | null;
  gamemode?: string | null;
  ping?: number;
  position?: { x: number; y: number; z: number } | null;
  heldItem?: string | null;
}

export interface BotChatMessage {
  text: string;
  timestamp: number;
  sender?: string;
}

export interface BotInventorySlot {
  slot: number;
  name: string;
  displayName?: string;
  count: number;
  lore?: string;
}

export interface CliSnapshot {
  profile: { id: string; name: string };
  scripts: Array<{ id: string; name: string; elapsed: string; progress?: string }>;
  bots: Array<{ id: string; username: string; server: string; script: string; status: string }>;
  remote: { active: boolean; connections: number; url: string | null; room: string | null };
}
