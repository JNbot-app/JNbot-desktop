import fs from 'fs';
import path from 'path';
import axios from 'axios';
import type { Entity } from 'prismarine-entity';
import type { Bot } from '../workerTypes';
import workerScript from '../lib/workerScript';
import scriptActionRunner from '../compiler/scriptActions';
import {
  compileTriggerFilter,
  describeTrigger,
  formatTriggerText,
  triggerAppliesTo,
  type Trigger,
  type TriggerEvent,
  type TriggerVars,
} from '../../../../common/triggers';
import type { NotificationPayload } from '../../../../common/mobileClientContract';
import type { AltTag } from '../../types';

type SourceContext = {
  bot: Bot;
  state: SourceState;
  fire: (subject: string | number, vars: TriggerVars) => void;
  /** Re-arm edge rules once their condition stops holding. */
  rearm: () => void;
};

type SourceState = { items?: Map<string, number>; itemTimer?: NodeJS.Timeout };

type EventSource = {
  /** Event to listen on. `disconnect` is driven by the bot's own `end` hook. */
  event?: string;
  /** Listen on `bot.inventory` instead of the bot. */
  inventory?: boolean;
  on: (ctx: SourceContext, ...args: any[]) => void;
  init?: (ctx: SourceContext) => void;
  /** Fire once when the condition starts holding, not on every event. */
  edge?: boolean;
  /** Ignore the burst of events a server (re)sends right after spawning. */
  settle?: boolean;
};

const SETTLE_MS = 5_000;
const text = (value: unknown) =>
  typeof value === 'string' ? value : String(value ?? '');

const onReason = ({ fire }: SourceContext, reason: unknown) =>
  fire(text(reason), { reason: text(reason) });

const onPlayer = (
  { bot, fire }: SourceContext,
  player: { username?: string },
) => {
  if (player.username && player.username !== bot.username)
    fire(player.username, { player: player.username });
};

/** Item name → count, including the item held on the cursor. */
const countItems = (bot: Bot) => {
  const counts = new Map<string, number>();
  const cursor = bot.inventory.selectedItem;
  const items = bot.inventory.items();
  for (const item of cursor ? [...items, cursor] : items)
    counts.set(
      item.displayName,
      (counts.get(item.displayName) ?? 0) + item.count,
    );
  return counts;
};

const SOURCES: Record<TriggerEvent, EventSource> = {
  chat: {
    event: 'messagestr',
    on: ({ fire }, message: string, position?: string) => {
      if (position !== 'game_info') fire(message, { message });
    },
  },
  join: { event: 'jnbot:inject_allowed', on: ({ fire }) => fire('', {}) },
  disconnect: { on: onReason },
  kicked: { event: 'kicked', on: onReason },
  death: { event: 'death', on: ({ fire }) => fire('', {}) },
  lowHealth: {
    event: 'health',
    edge: true,
    on: ({ bot, fire }) =>
      fire(bot.health, { health: String(Math.round(bot.health)) }),
  },
  playerNearby: {
    event: 'entitySpawn',
    settle: true,
    on: (ctx, entity: Entity) => {
      if (entity.type === 'player') onPlayer(ctx, entity);
    },
  },
  playerJoined: { event: 'playerJoined', settle: true, on: onPlayer },
  playerLeft: { event: 'playerLeft', settle: true, on: onPlayer },
  inventoryFull: {
    event: 'updateSlot',
    inventory: true,
    edge: true,
    on: ({ bot, fire, rearm }) =>
      bot.inventory.emptySlotCount() === 0 ? fire('', {}) : rearm(),
  },
  itemReceived: {
    event: 'updateSlot',
    inventory: true,
    settle: true,
    init: ({ bot, state }) => {
      state.items = countItems(bot);
    },
    // Moving items is a loss plus a gain, so diff totals after things settle.
    on: ({ bot, state, fire }) => {
      clearTimeout(state.itemTimer);
      state.itemTimer = setTimeout(() => {
        const before = state.items ?? new Map<string, number>();
        state.items = countItems(bot);
        for (const [item, count] of state.items) {
          const gained = count - (before.get(item) ?? 0);
          if (gained > 0) fire(item, { item, count: String(gained) });
        }
      }, 250);
    },
  },
};

/**
 * Event ids the old trigger system passed to script actions. Kept, together
 * with the old argument shape, so existing trigger actions keep working.
 */
const SCRIPT_EVENT_IDS: Record<TriggerEvent, string> = {
  chat: 'on_public_message',
  join: 'on_join',
  disconnect: 'on_disconnect',
  kicked: 'on_kicked',
  death: 'death',
  lowHealth: 'on_low_health',
  playerNearby: 'on_player_nearby',
  playerJoined: 'on_player_joined',
  playerLeft: 'on_player_left',
  inventoryFull: 'on_inventory_full',
  itemReceived: 'on_item_received',
};

const SUMMARY: Record<
  TriggerEvent,
  (v: TriggerVars & { bot: string }) => string
> = {
  chat: (v) => v.message ?? '',
  join: (v) => `${v.bot} joined the server`,
  disconnect: (v) => `${v.bot} disconnected${v.reason ? `: ${v.reason}` : ''}`,
  kicked: (v) => `${v.bot} was kicked${v.reason ? `: ${v.reason}` : ''}`,
  death: (v) => `${v.bot} died`,
  lowHealth: (v) => `${v.bot} is at ${v.health} HP`,
  playerNearby: (v) => `${v.player} is near ${v.bot}`,
  playerJoined: (v) => `${v.player} joined the server`,
  playerLeft: (v) => `${v.player} left the server`,
  inventoryFull: (v) => `${v.bot}'s inventory is full`,
  itemReceived: (v) => `${v.bot} received ${v.count}x ${v.item}`,
};

const SAMPLE_VARS: TriggerVars = {
  message: 'Test message',
  player: 'Steve',
  reason: 'Test',
  health: '5',
  item: 'Diamond',
  count: '1',
};

type Handler = {
  trigger: Trigger;
  matches: (subject: string | number) => boolean;
  armed: boolean;
  lastRun: number;
};

const attached = new Set<BotTriggers>();
const logStreams = new Map<string, fs.WriteStream>();
let listeningForUpdates = false;

/** Main pushes the new rule set whenever triggers or alt tags change. */
function listenForUpdates() {
  if (listeningForUpdates) return;
  listeningForUpdates = true;
  workerScript.onMessage<{ triggers: Trigger[]; altTags: AltTag[] }>(
    'TRIGGERS_UPDATE',
    ({ triggers, altTags }) => {
      global.settings.triggers = triggers;
      global.settings.altTags = altTags;
      for (const botTriggers of attached) botTriggers.bind();
    },
  );
  workerScript.onceMessage('TERMINATE', () => {
    for (const stream of logStreams.values()) stream.end();
  });
}

function appendLog(
  directory: string,
  bot: string,
  event: string,
  line: string,
) {
  const file = path.resolve(directory, bot, `${event}.log`);
  let stream = logStreams.get(file);
  if (!stream) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', (err) =>
      global.log(`Trigger log ${file} failed: ${err.message}`, 'error'),
    );
    logStreams.set(file, stream);
  }
  stream.write(`[${new Date().toISOString()}] ${line}\n`);
}

class BotTriggers {
  private handlers = new Map<TriggerEvent, Handler[]>();
  private listeners: [NodeJS.EventEmitter, string, (...args: any[]) => void][] =
    [];
  private readonly state: SourceState = {};
  private settledAt = Date.now() + SETTLE_MS;
  /** Trigger id → last run timestamp, published to the bot's `triggers` topic. */
  readonly lastFired: Record<string, number> = {};

  constructor(private readonly bot: Bot) {}

  bind() {
    this.unbind();
    const altTags = global.settings?.altTags ?? [];
    for (const trigger of global.settings?.triggers ?? []) {
      if (!trigger.enabled || !SOURCES[trigger.event]) continue;
      if (!triggerAppliesTo(trigger, this.bot.username, altTags)) continue;
      const handlers = this.handlers.get(trigger.event) ?? [];
      handlers.push({
        trigger,
        matches: compileTriggerFilter(trigger),
        armed: true,
        lastRun: 0,
      });
      this.handlers.set(trigger.event, handlers);
    }

    let settle = false;
    for (const event of this.handlers.keys()) {
      const source = SOURCES[event];
      const ctx = this.context(event);
      settle ||= Boolean(source.settle);
      source.init?.(ctx);
      if (source.event)
        this.listen(
          source.inventory ? this.bot.inventory : this.bot,
          source.event,
          (...args) => source.on(ctx, ...args),
        );
    }
    if (settle)
      this.listen(this.bot, 'spawn', () => {
        this.settledAt = Date.now() + SETTLE_MS;
      });
  }

  private context(event: TriggerEvent): SourceContext {
    return {
      bot: this.bot,
      state: this.state,
      fire: (subject, vars) => this.dispatch(event, subject, vars),
      rearm: () => {
        for (const handler of this.handlers.get(event) ?? [])
          handler.armed = true;
      },
    };
  }

  /** Disconnect has no regular listener: it runs right before teardown. */
  end(reason: unknown) {
    SOURCES.disconnect.on(this.context('disconnect'), reason);
    this.unbind();
  }

  test(id: string) {
    const trigger = global.settings?.triggers?.find((t) => t.id === id);
    if (!trigger) return false;
    this.run(trigger, SAMPLE_VARS);
    return true;
  }

  private listen(
    emitter: NodeJS.EventEmitter,
    event: string,
    listener: (...args: any[]) => void,
  ) {
    emitter.on(event, listener);
    this.listeners.push([emitter, event, listener]);
  }

  private unbind() {
    for (const [emitter, event, listener] of this.listeners)
      emitter.removeListener(event, listener);
    this.listeners = [];
    this.handlers.clear();
    clearTimeout(this.state.itemTimer);
  }

  private dispatch(
    event: TriggerEvent,
    subject: string | number,
    vars: TriggerVars,
  ) {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    const now = Date.now();
    if (SOURCES[event].settle && now < this.settledAt) return;
    let fired = false;
    for (const handler of handlers) {
      if (!handler.matches(subject)) {
        handler.armed = true;
        continue;
      }
      if (SOURCES[event].edge && !handler.armed) continue;
      handler.armed = false;
      const { cooldown, id } = handler.trigger;
      if (cooldown && now - handler.lastRun < cooldown * 1000) continue;
      handler.lastRun = now;
      this.lastFired[id] = now;
      fired = true;
      this.run(handler.trigger, vars);
    }
    if (fired) this.publish();
  }

  publish() {
    this.bot.messenger?.publish('triggers', this.lastFired);
  }

  private run(trigger: Trigger, eventVars: TriggerVars) {
    const bot = this.bot;
    const vars = { ...eventVars, bot: bot.username };
    const title = describeTrigger(trigger);
    const message = SUMMARY[trigger.event](vars);
    for (const action of trigger.actions) {
      // Report every failure in the bot's log, and keep running the other actions.
      const fail = (err: any) =>
        global.log(
          `Trigger "${title}" (${action.type}) failed for ${bot.username}: ${err?.stack ?? err?.message ?? err}`,
          'error',
        );
      try {
        switch (action.type) {
          case 'notification':
            workerScript.sendToClients('notification', {
              title: `${bot.username}: ${title}`,
              message,
              type: 'info',
              buttons: [
                { label: 'Open bot', action: 'openBot', botId: bot.botId },
              ],
            } satisfies NotificationPayload);
            break;
          case 'discord':
            axios
              .post(action.webhook, {
                embeds: [
                  {
                    title,
                    description: message.slice(0, 4095),
                    color: 0xfeca0b,
                    footer: { text: 'JNbot trigger' },
                    author: {
                      name: bot.username,
                      icon_url: `https://mc-heads.net/avatar/${bot.username}`,
                    },
                    timestamp: new Date().toISOString(),
                  },
                ],
              })
              .catch(fail);
            break;
          case 'chat':
            if (bot.isOnline?.() !== false)
              bot.chat(formatTriggerText(action.message, vars));
            break;
          case 'scriptAction':
            scriptActionRunner({
              id: action.id,
              bot,
              // Same shape the old triggers passed (an object, not an array).
              args: {
                ...vars,
                event: SCRIPT_EVENT_IDS[trigger.event],
                ...(vars.player && {
                  player: bot.players[vars.player] ?? { username: vars.player },
                }),
              } as unknown as unknown[],
            }).catch(fail);
            break;
          case 'log':
            appendLog(action.directory, bot.username, trigger.event, message);
            break;
        }
      } catch (err) {
        fail(err);
      }
    }
  }
}

/** Attach the configured trigger rules to a freshly injected bot. */
export function attachTriggers(bot: Bot) {
  listenForUpdates();
  const botTriggers = new BotTriggers(bot);
  botTriggers.bind();
  attached.add(botTriggers);
  bot.once('end', (reason) => {
    attached.delete(botTriggers);
    botTriggers.end(reason);
  });
  return botTriggers;
}
