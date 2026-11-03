/**
 * Component custom-id codec.
 *
 * Bot-control components encode as `b:<action>:<botId>:<arg>` and script
 * components as `s:<action>:<target>`. Kept tiny and dependency-free so both
 * the view builders and the interaction router can share it without cycles.
 */

export interface ParsedBotId {
  action: string;
  botId: number;
  arg: string;
}

/** Build a bot-control component id. `arg` is for compact payloads (e.g. slot). */
export function cid(action: string, botId: number, arg = ''): string {
  return `b:${action}:${botId}:${arg}`;
}

/** Build a script-control component id. */
export function scid(action: string, target: string): string {
  return `s:${action}:${target}`;
}

export function parseBotId(customId: string): ParsedBotId | null {
  const parts = customId.split(':');
  if (parts[0] !== 'b' || parts.length < 3) return null;
  const botId = Number(parts[2]);
  if (!Number.isFinite(botId)) return null;
  return { action: parts[1], botId, arg: parts.slice(3).join(':') };
}

export function parseScriptId(
  customId: string,
): { action: string; target: string } | null {
  const parts = customId.split(':');
  if (parts[0] !== 's' || parts.length < 3) return null;
  return { action: parts[1], target: parts.slice(2).join(':') };
}
