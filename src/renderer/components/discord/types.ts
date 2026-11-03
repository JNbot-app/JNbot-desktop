export type ActivityLevel = 'info' | 'success' | 'warn' | 'error';

export interface ActivityEvent {
  kind: string;
  message: string;
  level: ActivityLevel;
  ts: number;
}

export type DiscordStats =
  | {
      online: true;
      uptime: number;
      ping: number;
      commands: number;
      errors: number;
      guildName: string | null;
      guildId: string | null;
      memberCount: number;
      applicationId: string | null;
      tag: string | null;
    }
  | { online: false };

export interface DiscordCommandItem {
  name: string;
  syntax: string;
  description: string;
  category: 'Scripts' | 'Bots' | 'Utility';
}

export const DISCORD_COMMANDS: DiscordCommandItem[] = [
  {
    name: '/run-script',
    syntax: '/run-script [script]',
    description: "Run a script from the active profile",
    category: 'Scripts',
  },
  {
    name: '/run-plugin',
    syntax: '/run-plugin [plugin]',
    description: 'Execute a plugin from library',
    category: 'Scripts',
  },
  {
    name: '/stop',
    syntax: '/stop [script]',
    description: 'Stop a running script',
    category: 'Scripts',
  },
  {
    name: '/logs',
    syntax: '/logs [script] [lines]',
    description: 'Fetch recent console logs',
    category: 'Scripts',
  },
  {
    name: '/list',
    syntax: '/list [what]',
    description: 'List scripts, plugins, bots, or alts',
    category: 'Scripts',
  },
  {
    name: '/join',
    syntax: '/join [username]',
    description: 'Connect bot and open control panel',
    category: 'Bots',
  },
  {
    name: '/bot',
    syntax: '/bot [username]',
    description: 'Open bot control panel (chat, inventory, logs)',
    category: 'Bots',
  },
  {
    name: '/help',
    syntax: '/help',
    description: 'Show available commands',
    category: 'Utility',
  },
];

export const formatUptime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
};

export const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};
