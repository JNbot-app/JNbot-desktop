import { SlashCommandBuilder, ButtonStyle } from 'discord.js';
import type { AppSettings, JNdata, ServerTypes, SettingsObj, SharedSettings } from '../../../types';
import { embed, buttonRow, isSendableChannel, formatLogs } from './util';
import { scid } from './customId';
import { controlPanel } from './views';
import workerScript from '../../lib/workerScript';
import type {
  AutocompleteHandler,
  BotContext,
  CommandHandler,
  DiscordCommand,
  DiscordLogEntry,
} from './types';

/** Typed view of the worker's globals, so we never reach for `any`. */
interface WorkerScope {
  settings: SettingsObj;
  sharedSettings: SharedSettings;
  appSettings: AppSettings;
}
const workerScope = global as unknown as WorkerScope;

/* ------------------------------------------------------------------ */
/*  Command builders                                                  */
/* ------------------------------------------------------------------ */

function gamemodesFor(jn: JNdata, server: ServerTypes): string[] {
  return jn.data[server]?.kitGamemodes ?? [];
}

function buildRunScript() {
  return new SlashCommandBuilder()
    .setName('run-script')
    .setDescription("Run a script from the active server's profile")
    .addStringOption((o) =>
      o
        .setName('script')
        .setDescription('Script to run')
        .setRequired(true)
        .setAutocomplete(true),
    );
}

function buildRunPlugin() {
  return new SlashCommandBuilder()
    .setName('run-plugin')
    .setDescription('Run a plugin from your library')
    .addStringOption((o) =>
      o
        .setName('plugin')
        .setDescription('Plugin to run')
        .setRequired(true)
        .setAutocomplete(true),
    );
}

function buildLogs() {
  return new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Show recent console logs')
    .addStringOption((o) =>
      o
        .setName('script')
        .setDescription('Only show logs from this script')
        .setAutocomplete(true),
    )
    .addIntegerOption((o) =>
      o
        .setName('lines')
        .setDescription('How many lines to show (default 20, max 50)')
        .setMinValue(1)
        .setMaxValue(50),
    );
}

function buildJoin(jn: JNdata, server: ServerTypes) {
  const gamemodes = gamemodesFor(jn, server);
  return new SlashCommandBuilder()
    .setName('join')
    .setDescription('Bring a bot online and control it from Discord')
    .addStringOption((o) =>
      o.setName('username').setDescription('Bot username').setRequired(true).setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName('version')
        .setDescription('Minecraft version')
        .addChoices(
          ...jn.versions.slice(0, 25).map((v: string) => ({ name: v, value: v })),
        ),
    )
    .addStringOption((o) =>
      o
        .setName('gamemode')
        .setDescription('Gamemode to join after connecting')
        .addChoices(...gamemodes.slice(0, 25).map((g) => ({ name: g, value: g }))),
    )
    .addBooleanOption((o) =>
      o.setName('login').setDescription('Auto-login after joining'),
    );
}

function buildBot() {
  return new SlashCommandBuilder()
    .setName('bot')
    .setDescription('Open the control panel for an online bot')
    .addStringOption((o) =>
      o.setName('username').setDescription('Bot username').setAutocomplete(true),
    );
}

const buildList = () =>
  new SlashCommandBuilder()
    .setName('list')
    .setDescription('List scripts, bots, or alts')
    .addStringOption((o) =>
      o
        .setName('what')
        .setDescription('What to list')
        .setRequired(true)
        .addChoices(
          { name: 'active scripts', value: 'scripts' },
          { name: 'active bots', value: 'bots' },
          { name: 'profile scripts', value: 'available' },
          { name: 'plugins', value: 'plugins' },
          { name: 'alts', value: 'alts' },
        ),
    );

const buildStop = () =>
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop a running script')
    .addStringOption((o) =>
      o
        .setName('script')
        .setDescription('Script name or id')
        .setRequired(true)
        .setAutocomplete(true),
    );

const buildHelp = () =>
  new SlashCommandBuilder().setName('help').setDescription('Show all commands');

/* ------------------------------------------------------------------ */
/*  Script command handlers                                           */
/* ------------------------------------------------------------------ */

const runScript: CommandHandler = async (i, ctx) => {
  const choice = i.options.getString('script', true);
  const scripts = await workerScript.getProfileScripts().catch(() => []);
  // Autocomplete sends the profile-script id, but a user may type a name.
  const script = scripts.find((s) => s.id === choice || s.name === choice);

  if (!script) {
    await i.reply({
      embeds: [embed('Unknown script', `No profile script matches \`${choice}\`.`, 'error')],
      ephemeral: true,
    });
    return;
  }

  // Run by pluginId, exactly like a plugin — the main process re-resolves and
  // verifies the profile script from its id.
  workerScript.startScript({
    script: 'macro',
    arguments: { macroInfo: { name: script.name, pluginId: script.pluginId } },
  });
  ctx.activity('script_started', `${i.user.username} ran /run-script ${script.name}`);

  await i.reply({
    embeds: [embed(`▶ Started ${script.name}`, script.description || null, 'success')],
    components: [
      buttonRow(
        { id: scid('stop', script.name), label: 'Stop', style: ButtonStyle.Danger, emoji: '⏹' },
        { id: scid('logs', script.name), label: 'Logs', emoji: '📜' },
      ),
    ],
  });
};

const runPlugin: CommandHandler = async (i, ctx) => {
  const choice = i.options.getString('plugin', true);
  const plugins = await workerScript.getPlugins().catch(() => []);
  // Autocomplete sends the pluginId, but a user may type a name themselves.
  const plugin = plugins.find((p) => p.pluginId === choice || p.name === choice);

  if (!plugin) {
    await i.reply({
      embeds: [embed('Unknown plugin', `No plugin matches \`${choice}\`.`, 'error')],
      ephemeral: true,
    });
    return;
  }

  // The main process re-resolves and verifies the plugin from its id.
  workerScript.startScript({
    script: 'macro',
    arguments: { macroInfo: { name: plugin.name, pluginId: plugin.pluginId } },
  });
  ctx.activity('plugin_started', `${i.user.username} ran plugin ${plugin.name}`);

  await i.reply({
    embeds: [embed(`▶ Started ${plugin.name}`, plugin.description || null, 'success')],
    components: [
      buttonRow(
        { id: scid('stop', plugin.name), label: 'Stop', style: ButtonStyle.Danger, emoji: '⏹' },
        { id: scid('logs', plugin.name), label: 'Logs', emoji: '📜' },
      ),
    ],
  });
};

const logs: CommandHandler = async (i) => {
  const scriptName = i.options.getString('script') ?? undefined;
  const lines = i.options.getInteger('lines') ?? 20;
  const entries = await workerScript
    .getLogs({ scriptName, limit: lines })
    .catch(() => [] as DiscordLogEntry[]);

  if (!entries.length) {
    await i.reply({
      embeds: [
        embed(
          'No logs',
          scriptName ? `No logs from \`${scriptName}\` yet.` : 'No logs recorded yet.',
          'info',
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await i.reply({
    embeds: [
      embed(
        scriptName ? `📜 Logs — ${scriptName}` : '📜 Recent logs',
        formatLogs(entries, !scriptName),
        'info',
      ),
    ],
    ephemeral: true,
  });
};

const stop: CommandHandler = async (i, ctx) => {
  let target = i.options.getString('script', true);
  const active = await workerScript.getActiveScripts();

  if (!active[target]) {
    const byName = Object.values(active).find((s) => s.name === target);
    if (byName) target = String(byName.instanceId);
  }
  if (!active[target]) {
    await i.reply({
      embeds: [embed('Not running', `\`${target}\` is not active.`, 'error')],
    });
    return;
  }

  workerScript.stopScript(target);
  ctx.activity('script_stopped', `${i.user.username} stopped ${target}`);
  await i.reply({ embeds: [embed('⏹ Stopped', `\`${target}\``, 'info')] });
};

const list: CommandHandler = async (i, ctx) => {
  const what = i.options.getString('what', true);

  if (what === 'scripts') {
    const active = await workerScript.getActiveScripts();
    const lines = Object.values(active).map((s) => `• **${s.name}** \`${s.scriptId}\``);
    await i.reply({
      embeds: [
        embed(`Active scripts (${lines.length})`, lines.join('\n') || '_No scripts running_', 'info'),
      ],
    });
    return;
  }

  if (what === 'bots') {
    const bots = ctx.bots.list();
    const lines = bots.map((b) => {
      const info = b.info();
      return `• \`${b.username}\` — ${info.online ? '🟢' : '🔴'} ${info.gamemode}`;
    });
    await i.reply({
      embeds: [embed(`Active bots (${lines.length})`, lines.join('\n') || '_No bots online_', 'info')],
    });
    return;
  }

  if (what === 'available') {
    const scripts = await workerScript.getProfileScripts().catch(() => []);
    const lines = scripts.map((s) => `• \`${s.name}\``);
    await i.reply({
      embeds: [
        embed(
          `Profile scripts (${lines.length})`,
          lines.join('\n').slice(0, 4000) || '_No scripts on this profile_',
          'info',
        ),
      ],
    });
    return;
  }

  if (what === 'plugins') {
    const plugins = await workerScript.getPlugins().catch(() => []);
    const lines = plugins.map((p) => `• \`${p.name}\``);
    await i.reply({
      embeds: [
        embed(
          `Plugins (${lines.length})`,
          lines.join('\n').slice(0, 4000) || '_No plugins installed_',
          'info',
        ),
      ],
    });
    return;
  }

  if (what === 'alts') {
    const alts = workerScope.sharedSettings.alts ?? [];
    const lines = alts.map((a) => `• \`${a.username}\``);
    await i.reply({
      embeds: [
        embed(`Alts (${alts.length})`, lines.join('\n').slice(0, 4000) || '_No alts_', 'info'),
      ],
    });
  }
};

const help: CommandHandler = async (i, ctx) => {
  const lines = ctx.commands.map((c) => `**/${c.data.name}** — ${c.data.description}`);
  await i.reply({ embeds: [embed('Commands', lines.join('\n'), 'primary')] });
};

/* ------------------------------------------------------------------ */
/*  Bot command handlers                                              */
/* ------------------------------------------------------------------ */

const join: CommandHandler = async (i, ctx) => {
  const username = i.options.getString('username', true);
  const version = i.options.getString('version') ?? undefined;
  const gamemode = i.options.getString('gamemode');
  const login = i.options.getBoolean('login') ?? false;

  await i.deferReply();
  ctx.activity('bot_join', `${i.user.username} ran /join ${username}`);

  let session;
  try {
    session = await ctx.bots.join({ username, version, gamemode, login });
  } catch (err) {
    await i.editReply({
      embeds: [
        embed(
          'Join failed',
          `Could not join as \`${username}\`.\n${(err as Error).message}`,
          'error',
        ),
      ],
    });
    return;
  }

  if (isSendableChannel(i.channel)) session.attachChannel(i.channel);
  await i.editReply(controlPanel(session));
};

const bot: CommandHandler = async (i, ctx) => {
  const username = i.options.getString('username');
  const session = ctx.bots.resolve(username);

  if (!session) {
    await i.reply({
      embeds: [embed('No bot online', 'Use `/join` first to bring a bot online.', 'error')],
      ephemeral: true,
    });
    return;
  }

  if (isSendableChannel(i.channel)) session.attachChannel(i.channel);
  await i.reply(controlPanel(session));
};

/* ------------------------------------------------------------------ */
/*  Autocomplete                                                      */
/* ------------------------------------------------------------------ */

const autocompleteAlts: AutocompleteHandler = async (i) => {
  const focused = i.options.getFocused().toLowerCase();
  const alts = (workerScope.sharedSettings.alts ?? [])
    .map((a) => a.username)
    .filter((u) => u.toLowerCase().includes(focused))
    .slice(0, 25);
  await i.respond(alts.map((u) => ({ name: u, value: u })));
};

const autocompleteActiveBots: AutocompleteHandler = async (i, ctx) => {
  const focused = i.options.getFocused().toLowerCase();
  const names = ctx.bots
    .list()
    .map((s) => s.username)
    .filter((u) => u.toLowerCase().includes(focused))
    .slice(0, 25);
  await i.respond(names.map((u) => ({ name: u, value: u })));
};

const autocompleteActiveScripts: AutocompleteHandler = async (i) => {
  const focused = i.options.getFocused();
  const active = await workerScript.getActiveScripts().catch(() => ({}));
  const choices: { name: string; value: string }[] = [];
  for (const s of Object.values(active)) {
    if (s.name.includes(focused)) choices.push({ name: s.name, value: s.name });
    if (s.scriptId.includes(focused) && s.scriptId !== s.name)
      choices.push({ name: s.scriptId, value: s.scriptId });
  }
  await i.respond(choices.slice(0, 25));
};

const autocompleteProfileScripts: AutocompleteHandler = async (i) => {
  const focused = i.options.getFocused().toLowerCase();
  const scripts = await workerScript.getProfileScripts().catch(() => []);
  const choices = scripts
    .filter((s) => s.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((s) => ({ name: s.name, value: s.id }));
  await i.respond(choices);
};

const autocompletePlugins: AutocompleteHandler = async (i) => {
  const focused = i.options.getFocused().toLowerCase();
  const plugins = await workerScript.getPlugins().catch(() => []);
  const choices = plugins
    .filter((p) => p.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((p) => ({ name: p.name, value: p.pluginId }));
  await i.respond(choices);
};

const autocompleteLogScripts: AutocompleteHandler = async (i) => {
  const focused = i.options.getFocused().toLowerCase();
  const entries = await workerScript.getLogs().catch(() => []);
  const names = [...new Set(entries.map((e) => e.scriptName).filter(Boolean))]
    .filter((n) => n.toLowerCase().includes(focused))
    .slice(0, 25);
  await i.respond(names.map((n) => ({ name: n, value: n })));
};

/* ------------------------------------------------------------------ */
/*  Build the command list                                            */
/* ------------------------------------------------------------------ */

export function buildCommands(jn: JNdata, server: ServerTypes): DiscordCommand[] {
  return [
    { data: buildRunScript().toJSON(), execute: runScript, autocomplete: autocompleteProfileScripts },
    { data: buildRunPlugin().toJSON(), execute: runPlugin, autocomplete: autocompletePlugins },
    { data: buildLogs().toJSON(), execute: logs, autocomplete: autocompleteLogScripts },
    { data: buildStop().toJSON(), execute: stop, autocomplete: autocompleteActiveScripts },
    { data: buildList().toJSON(), execute: list },
    { data: buildJoin(jn, server).toJSON(), execute: join, autocomplete: autocompleteAlts },
    { data: buildBot().toJSON(), execute: bot, autocomplete: autocompleteActiveBots },
    { data: buildHelp().toJSON(), execute: help },
  ];
}

export type { BotContext, DiscordCommand };
