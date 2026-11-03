import {
  ButtonStyle,
  type ActionRowBuilder,
  type BaseMessageOptions,
  type ButtonBuilder,
  type StringSelectMenuBuilder,
} from 'discord.js';
import type { InventoryItemSlot } from '../../workerTypes';

type ComponentRow =
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<StringSelectMenuBuilder>;
import {
  BotSession,
  LOG_CATEGORIES,
  LOG_CATEGORY_INFO,
} from './botSession';
import { textInputModal, embed, buttonRow, selectRow, formatDuration, stripAnsi } from './util';
import { cid } from './customId';

/** Discord select menus accept at most 25 options. */
const MAX_SELECT_OPTIONS = 25;

/* ------------------------------------------------------------------ */
/*  Control panel                                                     */
/* ------------------------------------------------------------------ */

export function controlPanel(session: BotSession): BaseMessageOptions {
  const info = session.info();
  const lines = [
    `**Status:** ${info.online ? '🟢 Online' : '🔴 Offline'}`,
    `**Gamemode:** \`${info.gamemode}\``,
    info.position
      ? `**Position:** \`${info.position.x} ${info.position.y} ${info.position.z}\``
      : null,
    info.health != null
      ? `**Health:** ${info.health} ❤️   **Food:** ${info.food ?? '?'} 🍗`
      : null,
    info.level != null ? `**XP level:** ${info.level}` : null,
    info.ping != null ? `**Ping:** ${info.ping}ms` : null,
    info.windowTitle ? `**Open window:** ${info.windowTitle}` : null,
    `**Version:** \`${info.version}\`  •  **Uptime:** ${formatDuration(info.uptimeMs)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const id = session.botId;
  return {
    embeds: [embed(`🤖 ${info.username}`, lines, info.online ? 'success' : 'error')],
    components: [
      buttonRow(
        { id: cid('chat', id), label: 'Send chat', emoji: '💬', style: ButtonStyle.Primary },
        { id: cid('chatlog', id), label: 'Chat log', emoji: '📜' },
        { id: cid('inv', id), label: 'Inventory', emoji: '🎒' },
        { id: cid('info', id), label: 'Refresh', emoji: '🔄' },
      ),
      buttonRow(
        { id: cid('login', id), label: 'Login', emoji: '🔑' },
        { id: cid('close', id), label: 'Close window', emoji: '❎' },
        { id: cid('logs', id), label: 'Event logs', emoji: '🛎️' },
        { id: cid('leave', id), label: 'Disconnect', emoji: '🚪', style: ButtonStyle.Danger },
      ),
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Inventory                                                         */
/* ------------------------------------------------------------------ */

interface FilledSlot {
  item: InventoryItemSlot;
  slot: number;
}

function filledSlots(session: BotSession): { title: string; slots: FilledSlot[] } {
  const packet = session.getInventory();
  const items =
    packet && 'items' in packet
      ? (packet.items as (InventoryItemSlot | null)[])
      : [];
  const title =
    packet && 'title' in packet && typeof packet.title === 'string'
      ? stripAnsi(packet.title)
      : 'Inventory';

  const slots: FilledSlot[] = [];
  items.forEach((item, slot) => {
    if (item) slots.push({ item, slot });
  });
  return { title: title || 'Inventory', slots };
}

const slotLabel = (item: InventoryItemSlot): string =>
  item.displayName || item.name || 'item';

export function inventoryView(
  session: BotSession,
  selectedSlot?: number,
): BaseMessageOptions {
  const id = session.botId;
  const { title, slots } = filledSlots(session);

  const list = slots.length
    ? slots
        .slice(0, 40)
        .map(
          ({ item, slot }) =>
            `\`#${String(slot).padStart(2, ' ')}\` ${slotLabel(item)} ×${item.count}`,
        )
        .join('\n')
    : '_The inventory is empty_';

  const header =
    selectedSlot != null
      ? `Selected slot \`#${selectedSlot}\` — pick a click action below.`
      : 'Select an item to click it.';

  const components: ComponentRow[] = [];

  if (slots.length) {
    components.push(
      selectRow({
        id: cid('invsel', id),
        placeholder: 'Select an item…',
        options: slots.slice(0, MAX_SELECT_OPTIONS).map(({ item, slot }) => ({
          label: slotLabel(item).slice(0, 100),
          value: String(slot),
          description: `Slot ${slot} • ×${item.count}`,
          default: slot === selectedSlot,
        })),
      }),
    );
  }

  if (selectedSlot != null) {
    components.push(
      buttonRow(
        { id: cid('invclick', id, `${selectedSlot}_0_0`), label: 'Left click', emoji: '🖱️', style: ButtonStyle.Primary },
        { id: cid('invclick', id, `${selectedSlot}_1_0`), label: 'Right click', emoji: '🖱️' },
        { id: cid('invclick', id, `${selectedSlot}_0_1`), label: 'Shift click', emoji: '⬆️' },
      ),
    );
  }

  components.push(
    buttonRow(
      { id: cid('inv', id), label: 'Refresh', emoji: '🔄' },
      { id: cid('close', id), label: 'Close window', emoji: '❎' },
      { id: cid('panel', id), label: 'Back', emoji: '↩️' },
    ),
  );

  return {
    embeds: [embed(`🎒 ${title} — ${session.username}`, `${header}\n\n${list}`, 'primary')],
    components,
  };
}

/* ------------------------------------------------------------------ */
/*  Event logs                                                        */
/* ------------------------------------------------------------------ */

export function logsView(session: BotSession): BaseMessageOptions {
  const active = session.getCategories();
  const desc = LOG_CATEGORIES.map((c) => {
    const meta = LOG_CATEGORY_INFO[c];
    return `${meta.emoji} **${meta.label}** — ${active.has(c) ? '🟢 on' : '⚪ off'}  ·  _${meta.description}_`;
  }).join('\n');

  return {
    embeds: [
      embed(
        `🛎️ Event logging — ${session.username}`,
        `Choose which events stream to this channel.\n\n${desc}`,
        'info',
      ),
    ],
    components: [
      selectRow({
        id: cid('logsel', session.botId),
        placeholder: 'Toggle event categories…',
        minValues: 0,
        maxValues: LOG_CATEGORIES.length,
        options: session.categoryOptions(),
      }),
      buttonRow({ id: cid('panel', session.botId), label: 'Back', emoji: '↩️' }),
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Chat log + send-chat modal                                        */
/* ------------------------------------------------------------------ */

export function chatLogView(session: BotSession): BaseMessageOptions {
  const block = session.recentChatBlock();
  return {
    embeds: block
      ? undefined
      : [embed(`📜 ${session.username}`, '_No chat captured yet_', 'info')],
    content: block ? `📜 **${session.username}** — recent chat\n${block}` : undefined,
  };
}

export function sendChatModal(botId: number) {
  return textInputModal({
    customId: cid('chatmodal', botId),
    title: 'Send chat message',
    input: {
      id: 'message',
      label: 'Message or command',
      placeholder: 'Type a message, or /command …',
      maxLength: 256,
    },
  });
}
