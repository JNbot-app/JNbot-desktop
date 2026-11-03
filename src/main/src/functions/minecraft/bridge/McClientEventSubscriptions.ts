import type { JnbotMcBridgeEvent } from './protocol';
import type Script_ from '../../Script';
import { McClientEventPayloads } from 'common/types/McClientApi';



export const MC_CLIENT_EVENT_NAMES = [
  'mc.chat',
  'mc.position',
  'mc.window.open',
  'mc.window.close',
  'mc.window.items',
  'mc.player.forcedTeleport',
  'mc.health.changed',
  'mc.death',
  'mc.respawn',
  'mc.kicked',
  'mc.pathfinder.arrived',
  'mc.pathfinder.failed',
  'mc.entity.spawned',
  'mc.entity.died',
  'mc.entity.despawned',
  'mc.player.stateChanged',
  'mc.player.heldItemChanged',
  'mc.player.effectsChanged',
  'mc.dimension.changed',
  'mc.block.changed',
  'mc.ui.action',
  'mc.task.completed',
  'mc.task.failed',
  'mc.automation.action',
] as const;

export type McClientEventName = (typeof MC_CLIENT_EVENT_NAMES)[number];

export const isMcClientEventName = (value: unknown): value is McClientEventName =>
  typeof value === 'string' && (MC_CLIENT_EVENT_NAMES as readonly string[]).includes(value);


export type McClientEventSubscriptionOptions = {
  readonly throttle?: number;
  readonly compression?: boolean;
};

type OnSubscriptionChange = (args: {
  clientId: string;
  event: McClientEventName;
  subscribed: boolean;
}) => void;

const keyOf = (clientId: string, event: string) => `${clientId}\u0000${event}`;
const splitKey = (key: string): { clientId: string; event: string } => {
  const idx = key.indexOf('\u0000');
  if (idx < 0) return { clientId: key, event: '' };
  return { clientId: key.slice(0, idx), event: key.slice(idx + 1) };
};

export default class McClientEventSubscriptions {
  private readonly scriptsByKey = new Map<string, Map<number, Script_>>();
  private readonly keysByScript = new Map<number, Set<string>>();

  private readonly onChange: OnSubscriptionChange;

  constructor(onChange: OnSubscriptionChange) {
    this.onChange = onChange;
  }

  subscribe(script: Script_, clientId: string, event: McClientEventName): void {
    if (!script || !clientId || !event) return;

    const key = keyOf(clientId, event);
    const scriptId = script.instanceId;

    let scripts = this.scriptsByKey.get(key);
    const wasEmpty = !scripts || scripts.size === 0;

    if (!scripts) {
      scripts = new Map();
      this.scriptsByKey.set(key, scripts);
    }

    if (scripts.has(scriptId)) return;

    scripts.set(scriptId, script);

    let keys = this.keysByScript.get(scriptId);
    if (!keys) {
      keys = new Set();
      this.keysByScript.set(scriptId, keys);
    }
    keys.add(key);

    if (wasEmpty) {
      this.onChange({ clientId, event, subscribed: true });
    }
  }

  unsubscribe(script: Script_, clientId: string, event: McClientEventName): void {
    if (!script || !clientId || !event) return;

    const key = keyOf(clientId, event);
    const scripts = this.scriptsByKey.get(key);
    if (!scripts) return;

    const scriptId = script.instanceId;
    if (!scripts.has(scriptId)) return;

    scripts.delete(scriptId);

    const keys = this.keysByScript.get(scriptId);
    keys?.delete(key);
    if (keys && keys.size === 0) this.keysByScript.delete(scriptId);

    if (scripts.size === 0) {
      this.scriptsByKey.delete(key);
      this.onChange({ clientId, event, subscribed: false });
    }
  }

  unsubscribeAllForScript(instanceId: number): void {
    const keys = this.keysByScript.get(instanceId);
    if (!keys) return;

    for (const key of keys) {
      const scripts = this.scriptsByKey.get(key);
      if (!scripts) continue;

      scripts.delete(instanceId);
      if (scripts.size === 0) {
        this.scriptsByKey.delete(key);
        const { clientId, event } = splitKey(key);
        if (clientId && isMcClientEventName(event)) {
          this.onChange({ clientId, event, subscribed: false });
        }
      }
    }

    this.keysByScript.delete(instanceId);
  }

  unsubscribeAllForClient(clientId: string): void {
    if (!clientId) return;

    for (const key of [...this.scriptsByKey.keys()]) {
      const parsed = splitKey(key);
      if (parsed.clientId !== clientId) continue;

      const scripts = this.scriptsByKey.get(key);
      if (!scripts) continue;

      for (const scriptId of scripts.keys()) {
        this.keysByScript.get(scriptId)?.delete(key);
      }

      this.scriptsByKey.delete(key);
    }
  }

  listSubscribedEventsForClient(clientId: string): McClientEventName[] {
    if (!clientId) return [];

    const out = new Set<McClientEventName>();
    for (const key of this.scriptsByKey.keys()) {
      const parsed = splitKey(key);
      if (parsed.clientId !== clientId) continue;
      if (isMcClientEventName(parsed.event)) out.add(parsed.event);
    }
    return [...out];
  }

  publish(clientId: string, event: JnbotMcBridgeEvent): void {
    if (!clientId || !event?.name) return;

    if (!isMcClientEventName(event.name)) return;

    const key = keyOf(clientId, event.name);
    const scripts = this.scriptsByKey.get(key);
    if (!scripts || scripts.size === 0) return;

    const payload: { clientId: string; name: typeof event.name; data: McClientEventPayloads[typeof event.name] } = {
      clientId,
      name: event.name,
      data: event.data as McClientEventPayloads[typeof event.name],
    };

    for (const script of scripts.values()) {
      try {
        script.send('MC_CLIENT_EVENT', payload);
      } catch (err) {
        // Ignore send failures; script might be terminating.
      }
    }
  }
}
