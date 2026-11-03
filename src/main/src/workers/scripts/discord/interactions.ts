import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import type { BotContext, DiscordLogEntry } from './types';
import type { LogCategory } from './botSession';
import { embed, formatLogs } from './util';
import { parseBotId, parseScriptId } from './customId';
import workerScript from '../../lib/workerScript';
import {
  chatLogView,
  controlPanel,
  inventoryView,
  logsView,
  sendChatModal,
} from './views';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reply ephemerally that the targeted bot is gone, and return undefined. */
async function notFound(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): Promise<undefined> {
  await interaction.reply({
    embeds: [embed('Bot offline', 'That bot is no longer connected.', 'error')],
    ephemeral: true,
  });
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Buttons                                                           */
/* ------------------------------------------------------------------ */

export async function routeButton(
  interaction: ButtonInteraction,
  ctx: BotContext,
): Promise<void> {
  const script = parseScriptId(interaction.customId);
  if (script) return routeScriptButton(script, interaction, ctx);

  const parsed = parseBotId(interaction.customId);
  if (!parsed) return;

  const session = ctx.bots.get(parsed.botId);
  if (!session) {
    await notFound(interaction);
    return;
  }

  switch (parsed.action) {
    case 'panel':
    case 'info':
      await interaction.update(controlPanel(session));
      return;

    case 'inv':
      await interaction.update(inventoryView(session));
      return;

    case 'logs':
      await interaction.update(logsView(session));
      return;

    case 'chat':
      await interaction.showModal(sendChatModal(session.botId));
      return;

    case 'chatlog':
      await interaction.reply({ ...chatLogView(session), ephemeral: true });
      return;

    case 'invclick': {
      const [slot, button, mode] = parsed.arg.split('_').map(Number);
      session.clickSlot(slot, button || 0, mode || 0);
      ctx.activity('bot_click', `${session.username}: clicked slot ${slot}`);
      // Let the server apply the click before we re-read the inventory.
      await sleep(350);
      await interaction.update(inventoryView(session, slot));
      return;
    }

    case 'close':
      session.closeWindow();
      await sleep(250);
      await interaction.update(controlPanel(session));
      return;

    case 'login':
      session.login();
      await interaction.reply({
        embeds: [embed('🔑 Login sent', `Logging in \`${session.username}\``, 'info')],
        ephemeral: true,
      });
      return;

    case 'leave':
      session.disconnect();
      ctx.activity('bot_leave', `${session.username} disconnected (button)`);
      await interaction.update({
        embeds: [embed('🚪 Disconnected', `\`${session.username}\` left the server.`, 'info')],
        components: [],
      });
      return;

    default:
      return;
  }
}

async function routeScriptButton(
  { action, target }: { action: string; target: string },
  interaction: ButtonInteraction,
  ctx: BotContext,
): Promise<void> {
  if (action === 'stop') {
    workerScript.stopScript(target);
    ctx.activity('script_stopped', `${interaction.user.username} stopped ${target} (button)`);
    await interaction.reply({
      embeds: [embed('⏹ Stopped', `\`${target}\``, 'info')],
      ephemeral: true,
    });
    return;
  }

  if (action === 'logs') {
    await interaction.deferReply({ ephemeral: true });
    const entries = await workerScript
      .getLogs({ scriptName: target, limit: 20 })
      .catch(() => [] as DiscordLogEntry[]);
    await interaction.editReply({
      embeds: [
        embed(
          `📜 ${target}`,
          entries.length ? formatLogs(entries, false) : 'No logs from this script yet.',
          'info',
        ),
      ],
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Select menus                                                      */
/* ------------------------------------------------------------------ */

export async function routeSelect(
  interaction: StringSelectMenuInteraction,
  ctx: BotContext,
): Promise<void> {
  const parsed = parseBotId(interaction.customId);
  if (!parsed) return;

  const session = ctx.bots.get(parsed.botId);
  if (!session) {
    await notFound(interaction);
    return;
  }

  switch (parsed.action) {
    case 'invsel': {
      const slot = Number(interaction.values[0]);
      await interaction.update(inventoryView(session, slot));
      return;
    }

    case 'logsel': {
      session.setCategories(interaction.values as LogCategory[]);
      ctx.activity('bot_logs', `${session.username}: log categories updated`);
      await interaction.update(logsView(session));
      return;
    }

    default:
      return;
  }
}

/* ------------------------------------------------------------------ */
/*  Modals                                                            */
/* ------------------------------------------------------------------ */

export async function routeModal(
  interaction: ModalSubmitInteraction,
  ctx: BotContext,
): Promise<void> {
  const parsed = parseBotId(interaction.customId);
  if (!parsed) return;

  const session = ctx.bots.get(parsed.botId);
  if (!session) {
    await notFound(interaction);
    return;
  }

  if (parsed.action === 'chatmodal') {
    const message = interaction.fields.getTextInputValue('message').trim();
    if (!message) {
      await interaction.reply({
        embeds: [embed('Nothing sent', 'The message was empty.', 'warn')],
        ephemeral: true,
      });
      return;
    }
    session.sendChat(message);
    ctx.activity('bot_chat', `${session.username} sent: ${message}`);
    await interaction.reply({
      embeds: [embed('💬 Sent', `\`${message}\``, 'success')],
      ephemeral: true,
    });
  }
}
