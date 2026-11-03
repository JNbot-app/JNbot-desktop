import crypto from 'node:crypto';
import type Script_ from '../Script';
import type MinecraftBridgeManager from '../minecraft/MinecraftBridgeManager';
import type {
  McServerEventName,
  McServerEventPayloads,
  McServerHandleSummary,
  MinecraftServerState,
  MinecraftServerSummary,
} from '../../../../common/minecraftServers';
import type { JnbotMcBridgeEvent } from '../minecraft/bridge/protocol';
import McServer from './McServer';
import { isJnbotModAvailable } from '../minecraft/launcher/JnbotMods';

const wireEventNames: Partial<Record<string, McServerEventName>> = {
  'server.started': 'started',
  'server.stopping': 'stopping',
  'server.player.join': 'playerJoin',
  'server.player.leave': 'playerLeave',
  'server.chat': 'chat',
};
const eventNames = new Set<McServerEventName>([
  'stateChanged',
  'started',
  'stopping',
  'playerJoin',
  'playerLeave',
  'chat',
]);

export default class ManagedMinecraftServerBridge {
  private wired = false;
  private readonly scriptsByKey = new Map<string, Map<number, Script_>>();
  private readonly keysByScript = new Map<number, Set<string>>();

  constructor(
    private readonly clientBridge: MinecraftBridgeManager,
    private readonly getSummary: (
      id: string,
    ) => MinecraftServerSummary | undefined,
    private readonly onConnectionChanged: (id: string) => void,
  ) {}

  supports(version: string): boolean {
    return isJnbotModAvailable(version);
  }

  isConnected(id: string): boolean {
    return this.connectedServers().some((server) => server.serverId === id);
  }

  apiVersion(id: string): string | undefined {
    return this.connectedServers().find((server) => server.serverId === id)
      ?.modVersion;
  }

  register(id: string): string {
    const token = crypto.randomBytes(32).toString('base64url');
    this.ensureHub().registerManagedServer(id, token);
    return token;
  }

  revoke(id: string): void {
    this.clientBridge.getMcBridgeServer()?.revokeManagedServer(id);
  }

  get(id: string): McServer {
    const summary = this.getSummary(id);
    if (!summary || summary.role !== 'host' || summary.source !== 'dedicated')
      throw Object.assign(new Error('Managed Minecraft server not found'), {
        code: 'server_not_found',
      });
    return new McServer(this, id);
  }

  list(): McServerHandleSummary[] {
    const summaries: MinecraftServerSummary[] = [];
    for (const connected of this.connectedServers()) {
      const summary = this.getSummary(connected.serverId);
      if (summary) summaries.push(summary);
    }
    return summaries.map((summary) => ({
      id: summary.id,
      name: summary.name,
      version: summary.version,
      state: summary.state,
      apiState: summary.apiState,
    }));
  }

  request<T>(id: string, method: string, params?: unknown): Promise<T> {
    const summary = this.getSummary(id);
    if (!summary || summary.state !== 'online')
      return Promise.reject(
        Object.assign(new Error('Minecraft server is not running'), {
          code: 'server_not_running',
        }),
      );
    if (!this.supports(summary.version))
      return Promise.reject(
        Object.assign(
          new Error(`JNbot server API does not support ${summary.version}`),
          { code: 'unsupported_version' },
        ),
      );
    return this.ensureHub().sendManagedServerRequest<T>(id, method, params, {
      timeoutMs: method === 'server.command.execute' ? 15_000 : 5_000,
    });
  }

  subscribe(script: Script_, id: string, event: McServerEventName): void {
    this.get(id);
    if (!eventNames.has(event))
      throw new Error(`Unknown Minecraft server event: ${event}`);
    const key = `${id}\u0000${event}`;
    let scripts = this.scriptsByKey.get(key);
    const first = !scripts?.size;
    if (!scripts) {
      scripts = new Map();
      this.scriptsByKey.set(key, scripts);
    }
    scripts.set(script.instanceId, script);
    const keys = this.keysByScript.get(script.instanceId) ?? new Set<string>();
    keys.add(key);
    this.keysByScript.set(script.instanceId, keys);
    if (first && event !== 'stateChanged')
      void this.request(id, 'server.events.subscribe', {
        event: eventToWire(event),
      }).catch(() => undefined);
  }

  unsubscribe(script: Script_, id: string, event: McServerEventName): void {
    if (!eventNames.has(event)) return;
    const key = `${id}\u0000${event}`;
    const scripts = this.scriptsByKey.get(key);
    if (!scripts) return;
    scripts.delete(script.instanceId);
    this.keysByScript.get(script.instanceId)?.delete(key);
    if (scripts.size) return;
    this.scriptsByKey.delete(key);
    if (event !== 'stateChanged')
      void this.request(id, 'server.events.unsubscribe', {
        event: eventToWire(event),
      }).catch(() => undefined);
  }

  unsubscribeAll(instanceId: number): void {
    const keys = this.keysByScript.get(instanceId);
    if (!keys) return;
    for (const key of keys) {
      const scripts = this.scriptsByKey.get(key);
      scripts?.delete(instanceId);
      if (scripts?.size) continue;
      this.scriptsByKey.delete(key);
      const [serverId, event] = key.split('\u0000') as [
        string,
        McServerEventName,
      ];
      if (event !== 'stateChanged')
        void this.request(serverId, 'server.events.unsubscribe', {
          event: eventToWire(event),
        }).catch(() => undefined);
    }
    this.keysByScript.delete(instanceId);
  }

  publishState(
    id: string,
    previous: MinecraftServerState,
    state: MinecraftServerState,
  ) {
    this.publish(id, 'stateChanged', { previous, state });
  }

  private publish<E extends McServerEventName>(
    id: string,
    event: E,
    data: McServerEventPayloads[E],
  ) {
    const scripts = this.scriptsByKey.get(`${id}\u0000${event}`);
    if (!scripts) return;
    for (const script of scripts.values())
      script.send('MC_SERVER_EVENT', { serverId: id, name: event, data });
  }

  private onEvent(serverId: string, event: JnbotMcBridgeEvent) {
    const name = wireEventNames[event.name];
    if (!name) return;
    this.publish(serverId, name, event.data as never);
  }

  private connectedServers() {
    return this.clientBridge.getMcBridgeServer()?.listManagedServers() ?? [];
  }

  private ensureHub() {
    const hub = this.clientBridge.ensureMcBridgeServer();
    if (!this.wired) {
      this.wired = true;
      hub.on('managed-server-connected', (server) => {
        this.onConnectionChanged(server.serverId);
        this.clientBridge.scheduleIdleStop();
        for (const key of this.scriptsByKey.keys()) {
          const [serverId, event] = key.split('\u0000') as [
            string,
            McServerEventName,
          ];
          if (serverId !== server.serverId || event === 'stateChanged')
            continue;
          void hub
            .sendManagedServerRequest(serverId, 'server.events.subscribe', {
              event: eventToWire(event),
            })
            .catch(() => undefined);
        }
      });
      hub.on('managed-server-disconnected', (server) => {
        this.onConnectionChanged(server.serverId);
        this.clientBridge.scheduleIdleStop();
      });
      hub.on('managed-server-event', (server, event) => {
        this.onEvent(server.serverId, event);
      });
    }
    return hub;
  }
}

const eventToWire = (event: McServerEventName) =>
  Object.entries(wireEventNames).find(([, value]) => value === event)?.[0] ??
  event;
