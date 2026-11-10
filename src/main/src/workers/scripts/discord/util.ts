import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type APISelectMenuOption,
} from 'discord.js';
import { LogStatus } from '../../../../../common/CommonEnums';
import type { DiscordLogEntry, SendableChannel } from './types';

/* ------------------------------------------------------------------ */
/*  Colours / branding                                                */
/* ------------------------------------------------------------------ */

export const COLOR_PRIMARY = 0xfeca2d;
export const COLOR_SUCCESS = 0x22c55e;
export const COLOR_ERROR = 0xef4444;
export const COLOR_INFO = 0x3b82f6;
export const COLOR_WARN = 0xf59e0b;

export const FOOTER = {
  text: 'Powered by JNbot',
  iconURL: 'https://raw.githubusercontent.com/JNbot-app/JNbot-desktop/main/assets/icon.png',
};

export type EmbedKind = 'info' | 'success' | 'error' | 'primary' | 'warn';

const colorFor: Record<EmbedKind, number> = {
  info: COLOR_INFO,
  success: COLOR_SUCCESS,
  error: COLOR_ERROR,
  primary: COLOR_PRIMARY,
  warn: COLOR_WARN,
};

/** Discord caps an embed description at 4096 chars; keep a small margin. */
const MAX_EMBED_DESCRIPTION = 4090;

export function embed(
  title: string,
  description?: string | null,
  kind: EmbedKind = 'primary',
): APIEmbed {
  const e = new EmbedBuilder()
    .setColor(colorFor[kind])
    .setTitle(title.slice(0, 256))
    .setTimestamp(new Date())
    .setFooter(FOOTER);
  if (description) e.setDescription(description.slice(0, MAX_EMBED_DESCRIPTION));
  return e.toJSON();
}

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

export interface ButtonSpec {
  id: string;
  label: string;
  style?: ButtonStyle;
  emoji?: string;
  disabled?: boolean;
}

/** Build one action row of buttons (Discord allows up to 5 per row). */
export function buttonRow(
  ...buttons: ButtonSpec[]
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const b of buttons) {
    const btn = new ButtonBuilder()
      .setCustomId(b.id)
      .setLabel(b.label)
      .setStyle(b.style ?? ButtonStyle.Secondary)
      .setDisabled(b.disabled ?? false);
    if (b.emoji) btn.setEmoji(b.emoji);
    row.addComponents(btn);
  }
  return row;
}

export interface SelectSpec {
  id: string;
  placeholder: string;
  options: APISelectMenuOption[];
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
}

/** Build one action row containing a single string-select menu. */
export function selectRow(
  spec: SelectSpec,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(spec.id)
    .setPlaceholder(spec.placeholder.slice(0, 150))
    .setMinValues(spec.minValues ?? 1)
    .setMaxValues(spec.maxValues ?? 1)
    .setDisabled(spec.disabled ?? false)
    .addOptions(spec.options.slice(0, 25));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export interface TextInputSpec {
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  style?: TextInputStyle;
  required?: boolean;
  maxLength?: number;
}

/** Build a one-field modal — the only modal shape this bot needs so far. */
export function textInputModal(params: {
  customId: string;
  title: string;
  input: TextInputSpec;
}): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(params.input.id)
    .setLabel(params.input.label.slice(0, 45))
    .setStyle(params.input.style ?? TextInputStyle.Short)
    .setRequired(params.input.required ?? true);
  if (params.input.placeholder)
    input.setPlaceholder(params.input.placeholder.slice(0, 100));
  if (params.input.value) input.setValue(params.input.value.slice(0, 4000));
  if (params.input.maxLength) input.setMaxLength(params.input.maxLength);

  return new ModalBuilder()
    .setCustomId(params.customId)
    .setTitle(params.title.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
}

/* ------------------------------------------------------------------ */
/*  Text helpers                                                      */
/* ------------------------------------------------------------------ */

const ANSI_ESCAPE = /\[[0-9;]*m/g;

/** Remove ANSI SGR escapes so coloured Minecraft text reads cleanly in embeds. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE, '');
}

/**
 * Wrap pre-coloured text in a Discord ```ansi code block. Discord only renders
 * a subset of SGR codes — produce the input with {@link DISCORD_ANSI_CODES}.
 */
export function ansiBlock(content: string): string {
  return '```ansi\n' + content + '\n```';
}

export function codeBlock(content: string, lang = ''): string {
  return '```' + lang + '\n' + content + '\n```';
}

export function isSendableChannel(
  channel: unknown,
): channel is SendableChannel {
  return (
    !!channel &&
    typeof (channel as { send?: unknown }).send === 'function'
  );
}

/** Glyph shown in front of a log line, per {@link LogStatus} level. */
const LOG_GLYPH: Record<number, string> = {
  [LogStatus.INFO]: '·',
  [LogStatus.WARN]: '▲',
  [LogStatus.ERROR]: '✖',
  [LogStatus.SUCCESS]: '✔',
};

/** Embed descriptions cap at 4096 chars; reserve room for the code fence. */
const MAX_LOG_BODY = 3800;

/**
 * Render log entries as a single code block, newest kept when over budget.
 * `showScript` prefixes each line with its script name (omit when the logs
 * are already scoped to one script).
 */
export function formatLogs(
  entries: DiscordLogEntry[],
  showScript = true,
): string {
  const lines = entries.map((e) => {
    const time = new Date(e.ts).toLocaleTimeString();
    const glyph = LOG_GLYPH[e.level] ?? '·';
    const name = showScript && e.scriptName ? ` [${e.scriptName}]` : '';
    return `${time} ${glyph}${name} ${stripAnsi(e.text)}`;
  });
  let body = lines.join('\n');
  if (body.length > MAX_LOG_BODY) body = body.slice(body.length - MAX_LOG_BODY);
  return codeBlock(body);
}

/** Format ms as a human-readable duration. */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
