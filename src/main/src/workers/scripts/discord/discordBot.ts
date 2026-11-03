import {
  Client,
  GatewayIntentBits,
  ActivityType,
  Events,
  REST,
  Routes,
  type Interaction,
} from 'discord.js';
import type { JNdata, ServerTypes } from '../../../types';
import { getScriptSettings } from '../../bot/scriptFunctional';
import { buildCommands } from './commands';
import { routeButton, routeModal, routeSelect } from './interactions';
import { BotManager } from './botManager';
import { embed } from './util';
import type { ActivityLevel, BotContext, DiscordCommand } from './types';
import workerScript from '../../lib/workerScript';

interface DiscordSettings {
  token?: string;
  roles?: string[];
  blockedRoles?: string[];
}

export type { BotContext };

class DiscordBot {
  private client!: Client;
  private rest!: REST;
  private settings: DiscordSettings;
  private commands: DiscordCommand[] = [];
  private readonly bots = new BotManager();
  private commandCount = 0;
  private errorCount = 0;
  private startedAt = Date.now();
  private statsInterval?: NodeJS.Timeout;

  constructor() {
    this.settings = getScriptSettings('discord');
    workerScript.onceMessage('TERMINATE', () => this.bots.disposeAll());
  }

  async start() {
    const token = this.settings.token;
    if (!token) {
      this.notify('No Discord token configured', 'error');
      return this.stop();
    }

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
    this.rest = new REST().setToken(token);

    this.client.once(Events.ClientReady, (c) => this.onReady(c));
    this.client.on(Events.InteractionCreate, (i) => this.onInteraction(i));
    this.client.on(Events.ShardError, (e) =>
      this.activity('error', e.message, 'error'),
    );
    this.client.on(Events.ShardReconnecting, () =>
      this.activity('reconnecting', 'Reconnecting to gateway', 'warn'),
    );
    this.client.on(Events.ShardResume, () =>
      this.activity('reconnected', 'Bot reconnected to gateway', 'success'),
    );

    try {
      await this.client.login(token);
    } catch (err) {
      this.notify(
        err instanceof Error ? err.message : 'Discord login failed',
        'error',
      );
      this.stop();
    }
  }

  private async onReady(client: Client<true>) {
    client.user.setPresence({
      activities: [{ name: 'JNbot', type: ActivityType.Playing }],
      status: 'online',
    });

    const jn: JNdata = await workerScript.getJNdata();
    const server = global.appSettings.server as ServerTypes;

    this.commands = buildCommands(jn, server);

    await this.rest.put(Routes.applicationCommands(client.user.id), {
      body: this.commands.map((c) => c.data),
    });

    this.activity(
      'ready',
      `Bot registered ${this.commands.length} slash commands`,
      'success',
    );
    this.reportStats();
    this.statsInterval = setInterval(() => this.reportStats(), 10_000);
  }

  private async onInteraction(interaction: Interaction) {
    try {
      if (interaction.isAutocomplete()) {
        const cmd = this.commands.find(
          (c) => c.data.name === interaction.commandName,
        );
        if (cmd?.autocomplete) await cmd.autocomplete(interaction, this.ctx());
        return;
      }

      // Everything else mutates a bot/script, so gate it behind the role rules.
      if (!this.isAllowed(interaction)) {
        await this.denyPermission(interaction);
        return;
      }

      if (interaction.isButton()) return routeButton(interaction, this.ctx());
      if (interaction.isStringSelectMenu())
        return routeSelect(interaction, this.ctx());
      if (interaction.isModalSubmit())
        return routeModal(interaction, this.ctx());
      if (!interaction.isChatInputCommand()) return;

      const cmd = this.commands.find(
        (c) => c.data.name === interaction.commandName,
      );
      if (!cmd) return;

      this.commandCount++;
      this.activity(
        'command',
        `@${interaction.user.username} ran /${interaction.commandName}`,
        'success',
      );

      await cmd.execute(interaction, this.ctx());
    } catch (err) {
      this.errorCount++;
      const message = err instanceof Error ? err.message : 'unknown error';
      console.error('[Discord] interaction error', err);
      this.activity('error', message, 'error');
      if (interaction.isRepliable() && !interaction.replied) {
        await interaction
          .reply({
            embeds: [embed('Error', message, 'error')],
            ephemeral: true,
          })
          .catch(() => undefined);
      }
    }
  }

  /** Role ids the interacting member holds, across both member shapes. */
  private memberRoleIds(interaction: Interaction): string[] {
    const member = interaction.member;
    if (!member) return [];
    const roles = member.roles;
    if (Array.isArray(roles)) return roles;
    return roles?.cache ? [...roles.cache.keys()] : [];
  }

  /** Block-list wins over allow-list; empty allow-list means "everyone". */
  private isAllowed(interaction: Interaction): boolean {
    const allow = this.settings.roles ?? [];
    const block = this.settings.blockedRoles ?? [];
    const ids = this.memberRoleIds(interaction);
    if (block.length && ids.some((r) => block.includes(r))) return false;
    if (allow.length === 0) return true;
    return ids.some((r) => allow.includes(r));
  }

  private async denyPermission(interaction: Interaction): Promise<void> {
    const label = interaction.isChatInputCommand()
      ? `/${interaction.commandName}`
      : 'interaction';
    this.activity(
      'rejected',
      `@${interaction.user.username} ${label} — missing role`,
      'warn',
    );
    if (interaction.isRepliable()) {
      await interaction
        .reply({
          embeds: [
            embed('Permission denied', 'You lack the required role.', 'error'),
          ],
          ephemeral: true,
        })
        .catch(() => undefined);
    }
  }

  private ctx(): BotContext {
    return {
      client: this.client,
      commands: this.commands,
      bots: this.bots,
      activity: this.activity.bind(this),
    };
  }

  private activity(
    kind: string,
    message: string,
    level: ActivityLevel = 'info',
  ) {
    global.sendToClients(
      'DISCORD_ACTIVITY',
      { kind, message, level, ts: Date.now() },
    );
  }

  private reportStats() {
    if (!this.client?.isReady()) return;
    const guild = this.client.guilds.cache.first();
    global.sendToClients(
      'DISCORD_STATS',
      {
        online: true,
        uptime: Date.now() - this.startedAt,
        ping: this.client.ws.ping,
        commands: this.commandCount,
        errors: this.errorCount,
        guildName: guild?.name ?? null,
        guildId: guild?.id ?? null,
        memberCount: guild?.memberCount ?? 0,
        applicationId: this.client.user?.id ?? null,
        tag: this.client.user?.tag ?? null,
      },
    );
  }

  private notify(message: string, variant: string) {
    global.sendToClients('snackbar', { title: message, variant });
  }

  stop() {
    if (this.statsInterval) clearInterval(this.statsInterval);
    this.bots.disposeAll();
    global.sendToClients('DISCORD_STATS', { online: false });
    this.client?.destroy().catch(() => undefined);
    process.exit();
  }
}

async function main() {
  const bot = new DiscordBot();
  await bot.start();
}

export default main;
