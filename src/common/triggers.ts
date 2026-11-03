/**
 * Trigger rules: "when <event> happens on <bots>, run <actions>". Stored per
 * server in `settings.triggers` and evaluated inside the bot workers, so a
 * rule runs whenever a matching bot is online — no UI needs to be open.
 *
 * Shared by the desktop renderer, the worker runtime and the mobile client.
 */

/** How the optional `filter` field of a rule is interpreted. */
export type TriggerFilterKind = 'text' | 'players' | 'number';

export type TriggerEventDefinition = {
  name: string;
  description: string;
  filter?: {
    kind: TriggerFilterKind;
    label: string;
    placeholder?: string;
  };
  /** Placeholders available in action messages, e.g. `{player}`. */
  vars: readonly string[];
  /** Cooldown (seconds) a new rule for this event starts with. */
  cooldown?: number;
};

const EVENTS = {
  chat: {
    name: 'Chat message',
    description: 'A message appears in chat.',
    filter: {
      kind: 'text',
      label: 'Only when the message contains',
      placeholder: 'Any message — or text, or /regex/i',
    },
    vars: ['message'],
    cooldown: 5,
  },
  join: {
    name: 'Joined server',
    description: 'The bot joined the server and is ready.',
    vars: [],
  },
  disconnect: {
    name: 'Disconnected',
    description: 'The bot lost its connection to the server.',
    filter: {
      kind: 'text',
      label: 'Only when the reason contains',
      placeholder: 'Any reason',
    },
    vars: ['reason'],
  },
  kicked: {
    name: 'Kicked',
    description: 'The bot was kicked from the server.',
    filter: {
      kind: 'text',
      label: 'Only when the reason contains',
      placeholder: 'Any reason',
    },
    vars: ['reason'],
  },
  death: {
    name: 'Died',
    description: 'The bot died.',
    vars: [],
  },
  lowHealth: {
    name: 'Low health',
    description: 'The bot’s health drops below a threshold.',
    filter: {
      kind: 'number',
      label: 'Health below (max 20)',
      placeholder: '6',
    },
    vars: ['health'],
    cooldown: 30,
  },
  playerNearby: {
    name: 'Player nearby',
    description: 'Another player comes into the bot’s view distance.',
    filter: {
      kind: 'players',
      label: 'Only these players',
      placeholder: 'Any player',
    },
    vars: ['player'],
    cooldown: 60,
  },
  playerJoined: {
    name: 'Player joined',
    description: 'Another player joins the server.',
    filter: {
      kind: 'players',
      label: 'Only these players',
      placeholder: 'Any player',
    },
    vars: ['player'],
  },
  playerLeft: {
    name: 'Player left',
    description: 'Another player leaves the server.',
    filter: {
      kind: 'players',
      label: 'Only these players',
      placeholder: 'Any player',
    },
    vars: ['player'],
  },
  inventoryFull: {
    name: 'Inventory full',
    description: 'The bot’s inventory has no free slots left.',
    vars: [],
    cooldown: 300,
  },
  itemReceived: {
    name: 'Item received',
    description: 'The bot gains items, e.g. by picking up or /give.',
    filter: {
      kind: 'text',
      label: 'Only when the item name contains',
      placeholder: 'Any item — or text, or /regex/i',
    },
    vars: ['item', 'count'],
    cooldown: 5,
  },
} as const satisfies Record<string, TriggerEventDefinition>;

export type TriggerEvent = keyof typeof EVENTS;
export const TRIGGER_EVENTS: Record<TriggerEvent, TriggerEventDefinition> =
  EVENTS;
export const TRIGGER_EVENT_IDS = Object.keys(TRIGGER_EVENTS) as TriggerEvent[];

export type TriggerAction =
  | { type: 'notification' }
  | { type: 'discord'; webhook: string }
  | { type: 'chat'; message: string }
  | { type: 'scriptAction'; id: string }
  | { type: 'log'; directory: string };

export type TriggerActionType = TriggerAction['type'];

export const TRIGGER_ACTION_TYPES: Record<
  TriggerActionType,
  { name: string; description: string }
> = {
  notification: {
    name: 'JNbot notification',
    description: 'Show a notification in JNbot.',
  },
  discord: {
    name: 'Discord webhook',
    description: 'Post the event to a Discord channel.',
  },
  chat: {
    name: 'Send chat message',
    description: 'Let the bot say something or run a command.',
  },
  scriptAction: {
    name: 'Run script action',
    description: 'Run a plugin action on the bot.',
  },
  log: {
    name: 'Log to file',
    description: 'Append the event to a log file per bot.',
  },
};

export interface Trigger {
  id: string;
  event: TriggerEvent;
  enabled: boolean;
  actions: TriggerAction[];
  /** Event-specific condition, see {@link TriggerEventDefinition.filter}. */
  filter?: string;
  /** Limit to these accounts / tag ids. Both empty means every bot. */
  alts?: string[];
  tags?: string[];
  /** Minimum seconds between two runs on the same bot. */
  cooldown?: number;
  /** Optional label; the UI falls back to {@link describeTrigger}. */
  name?: string;
}

export type TriggerVars = Partial<
  Record<'message' | 'player' | 'reason' | 'health' | 'item' | 'count', string>
>;

/** A fresh rule with the event's defaults filled in. */
export const newTrigger = (
  id: string,
  patch: Partial<Trigger> = {},
): Trigger => {
  const event = patch.event ?? 'chat';
  return {
    id,
    event,
    enabled: true,
    cooldown: TRIGGER_EVENTS[event].cooldown ?? 0,
    actions: [{ type: 'notification' }],
    ...patch,
  };
};

export const newTriggerAction = (type: TriggerActionType): TriggerAction => {
  switch (type) {
    case 'discord':
      return { type, webhook: '' };
    case 'chat':
      return { type, message: '' };
    case 'scriptAction':
      return { type, id: '' };
    case 'log':
      return { type, directory: '' };
    default:
      return { type };
  }
};

/** Returns the first problem that prevents saving, or null when valid. */
export function triggerProblem(trigger: Trigger): string | null {
  if (!(trigger.event in TRIGGER_EVENTS)) return 'Choose an event.';
  if (!trigger.actions.length) return 'Add at least one action.';
  for (const action of trigger.actions) {
    if (
      action.type === 'discord' &&
      !/^https?:\/\//.test(action.webhook.trim())
    )
      return 'Enter a Discord webhook URL.';
    if (action.type === 'chat' && !action.message.trim())
      return 'Enter the chat message to send.';
    if (action.type === 'scriptAction' && !action.id)
      return 'Choose a script action.';
    if (action.type === 'log' && !action.directory.trim())
      return 'Choose a log directory.';
  }
  const kind = TRIGGER_EVENTS[trigger.event].filter?.kind;
  if (
    kind === 'text' &&
    trigger.filter &&
    parseRegex(trigger.filter) === undefined
  )
    return 'The filter is not a valid regular expression.';
  return null;
}

/** Whether the rule targets the bot with this username. */
export function triggerAppliesTo(
  trigger: Pick<Trigger, 'alts' | 'tags'>,
  username: string,
  altTags: readonly { id: string; alts: readonly string[] }[] = [],
): boolean {
  const alts = trigger.alts ?? [];
  const tags = trigger.tags ?? [];
  if (!alts.length && !tags.length) return true;
  if (alts.includes(username)) return true;
  return altTags.some(
    (tag) => tags.includes(tag.id) && tag.alts.includes(username),
  );
}

/** `/source/flags` → RegExp, invalid regex → undefined, plain text → null. */
function parseRegex(filter: string): RegExp | null | undefined {
  const match = /^\/(.+)\/([a-z]*)$/.exec(filter.trim());
  if (!match) return null;
  try {
    // Stateful flags would make `test()` alternate between results.
    return new RegExp(match[1], match[2].replace(/[gy]/g, ''));
  } catch {
    return undefined;
  }
}

export const splitPlayers = (filter = '') =>
  filter
    .split(/[\s,]+/)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

/**
 * Compile the rule's filter once, so evaluating an event is a single cheap
 * call. The returned predicate receives the event's subject (message, player
 * name, reason) or numeric value (health).
 */
export function compileTriggerFilter(
  trigger: Pick<Trigger, 'event' | 'filter'>,
): (subject: string | number) => boolean {
  const kind = TRIGGER_EVENTS[trigger.event]?.filter?.kind;
  const filter = trigger.filter?.trim();
  if (kind === 'number') {
    const threshold = Number(filter) || 6;
    return (value) => Number(value) < threshold;
  }
  if (!kind || !filter) return () => true;
  if (kind === 'players') {
    const players = new Set(splitPlayers(filter));
    return (name) => players.has(String(name).toLowerCase());
  }
  const regex = parseRegex(filter);
  if (regex) return (text) => regex.test(String(text));
  if (regex === undefined) return () => false;
  const needle = filter.toLowerCase();
  return (text) => String(text).toLowerCase().includes(needle);
}

/** Replace `{bot}`, `{player}`, ... placeholders. Unknown ones stay as-is. */
export const formatTriggerText = (
  template: string,
  vars: TriggerVars & { bot?: string },
) =>
  template.replace(
    /\{(\w+)\}/g,
    (raw, key: string) => vars[key as keyof typeof vars] ?? raw,
  );

/** Human summary, e.g. `Chat message containing "pay"`. */
export function describeTrigger(trigger: Trigger): string {
  if (trigger.name?.trim()) return trigger.name.trim();
  const event = TRIGGER_EVENTS[trigger.event];
  if (!event) return 'Unknown event';
  const filter = trigger.filter?.trim();
  if (!filter || !event.filter) return event.name;
  switch (event.filter.kind) {
    case 'number':
      return `${event.name} (below ${filter} HP)`;
    case 'players':
      return `${event.name}: ${splitPlayers(filter).join(', ')}`;
    default:
      return `${event.name} matching "${filter}"`;
  }
}

/* eslint-disable no-bitwise */
const LEGACY_EVENTS: Record<string, TriggerEvent> = {
  on_public_message: 'chat',
  on_inject_allowed: 'join',
  on_join: 'join',
  on_kicked: 'kicked',
  on_disconnect: 'disconnect',
  on_player_left: 'playerLeft',
  on_player_joined: 'playerJoined',
  on_death: 'death',
};

/**
 * Convert the old `{ [legacyId]: { active: bitmask, ... } }` format. Rules
 * that were not "on by default" only ran after enabling them on a live bot,
 * so they come over disabled.
 */
export function migrateLegacyTriggers(value: unknown): Trigger[] {
  if (Array.isArray(value)) return value as Trigger[];
  if (!value || typeof value !== 'object') return [];
  const triggers: Trigger[] = [];
  for (const [legacyId, legacy] of Object.entries(
    value as Record<string, any>,
  )) {
    const event = LEGACY_EVENTS[legacyId];
    const active = Number(legacy?.active) || 0;
    if (!event || !active) continue;
    const actions: TriggerAction[] = [];
    if (active & (1 << 2)) actions.push({ type: 'notification' });
    if (active & (1 << 1) && legacy.webhook)
      actions.push({ type: 'discord', webhook: String(legacy.webhook) });
    if (active & (1 << 3) && legacy.directory)
      actions.push({ type: 'log', directory: String(legacy.directory) });
    if (active & (1 << 4) && Array.isArray(legacy.actions))
      for (const id of legacy.actions)
        actions.push({ type: 'scriptAction', id: String(id) });
    if (!actions.length) continue;
    triggers.push({
      id: `legacy-${legacyId}`,
      event,
      enabled: Boolean(legacy.onByDefault),
      actions,
    });
  }
  return triggers;
}
/* eslint-enable no-bitwise */
