/**
 * Minecraft chat → Discord ANSI rendering.
 *
 * prismarine-chat's default `toAnsi()` emits bright (90–97) and truecolor
 * (38;2;r;g;b) SGR codes. Discord's ```ansi highlighter only understands the
 * basic 30–37 foreground codes plus a few styles, so we feed `toAnsi()` a
 * custom code map that stays inside that supported subset. Anything Discord
 * can't render (italic / strikethrough / obfuscated) is dropped rather than
 * leaking raw escape markers into the message.
 */
export const DISCORD_ANSI_CODES: Record<string, string> = {
  '§0': '[30m', // black
  '§1': '[34m', // dark blue
  '§2': '[32m', // dark green
  '§3': '[36m', // dark aqua
  '§4': '[31m', // dark red
  '§5': '[35m', // dark purple
  '§6': '[33m', // gold
  '§7': '[37m', // gray
  '§8': '[30m', // dark gray
  '§9': '[34m', // blue
  '§a': '[32m', // green
  '§b': '[36m', // aqua
  '§c': '[31m', // red
  '§d': '[35m', // light purple
  '§e': '[33m', // yellow
  '§f': '[37m', // white
  '§l': '[1m', // bold
  '§n': '[4m', // underline
  '§o': '', // italic — unsupported by Discord
  '§m': '', // strikethrough — unsupported
  '§k': '', // obfuscated — unsupported
  '§r': '[0m', // reset
};

/**
 * A prismarine-chat message — only the bits we touch are typed. `toAnsi` is
 * left as `unknown` so the concrete `ChatMessage` (whose colour-map param is a
 * narrower type) stays structurally assignable.
 */
export interface ChatMessageLike {
  toAnsi?: unknown;
  toString(): string;
}

type ToAnsiFn = (lang?: string, codes?: Record<string, string>) => string;

/** Render a chat message as Discord-safe ANSI, falling back to plain text. */
export function chatToDiscordAnsi(message: ChatMessageLike): string {
  if (typeof message.toAnsi === 'function') {
    return (message.toAnsi as ToAnsiFn)('en_us', DISCORD_ANSI_CODES);
  }
  return String(message);
}

/**
 * Turn a kick / disconnect reason (string, ChatMessage, or raw JSON object)
 * into a readable single line.
 */
export function stringifyReason(reason: unknown): string {
  if (reason == null) return 'unknown reason';
  if (typeof reason === 'string') return reason;
  const maybe = reason as ChatMessageLike;
  if (typeof maybe?.toString === 'function') {
    const str = maybe.toString();
    if (str && str !== '[object Object]') return str;
  }
  try {
    return JSON.stringify(reason);
  } catch {
    return 'unknown reason';
  }
}
