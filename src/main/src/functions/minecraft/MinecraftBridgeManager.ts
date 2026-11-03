import type MinecraftInstances from './MinecraftInstances';
import type MinecraftSessions from './MinecraftSessions';
import type ActiveBots_ from '../ActiveBots';
import {
  getMcBridgeServer,
  startMcBridgeServer,
  stopMcBridgeServer,
} from './bridge';
import type JnbotMcBridgeServer from './bridge/JnbotMcBridgeServer';
import MinecraftBridgeEvents from './bridge/MinecraftBridgeEvents';
import McClient from './bridge/McClient';
import McClientEventSubscriptions, { McClientEventName } from './bridge/McClientEventSubscriptions';
import type Script_ from '../Script';
import type { JnbotMcBridgeEvent } from './bridge/protocol';

type RawClientEventListener = (
  client: {
    clientId: string;
    instanceId?: string;
    username?: string;
    uuid?: string;
    mcVersion?: string;
  },
  event: JnbotMcBridgeEvent,
) => void;

class MinecraftBridgeManager {
  private minecraftInstances: MinecraftInstances;
  private minecraftSessions: MinecraftSessions;
  private activeBotsForInstance: (
    instanceId?: string,
  ) => ActiveBots_ | undefined;
  private events: MinecraftBridgeEvents | null;
  private readonly mcClientsById = new Map<string, McClient>();
  private mcBridgeWired = false;
  private mcBridgeIdleStopTimer: NodeJS.Timeout | null = null;
  private readonly rawClientEventListeners = new Set<RawClientEventListener>();
  private readonly clientDisconnectedListeners = new Set<
    (clientId: string) => void
  >();
  private readonly systemClientEventSubscriptions = new Map<
    string,
    Set<McClientEventName>
  >();

  private readonly mcClientEventSubscriptions = new McClientEventSubscriptions(
    ({ clientId, event, subscribed }) => {
      const server = getMcBridgeServer();
      if (!server) {
        console.warn('[McBridge][MC_EVENTS] onChange but server is null', {
          clientId,
          event,
          subscribed,
        });
        return;
      }

      if (
        !subscribed &&
        this.systemClientEventSubscriptions.get(clientId)?.has(event)
      )
        return;
      const name = subscribed ? 'mc.events.subscribe' : 'mc.events.unsubscribe';
      const ok = server.sendCommand(clientId, name, { event });
      if (!ok) {
        const connected = server.listClients().map((c) => c.clientId);
        console.warn(
          '[McBridge][MC_EVENTS] failed to send command (client not connected?)',
          {
            clientId,
            event,
            name,
            connectedClients: connected,
          },
        );
      }
    },
  );

  constructor(
    minecraftInstances: MinecraftInstances,
    minecraftSessions: MinecraftSessions,
    activeBotsForInstance: (instanceId?: string) => ActiveBots_ | undefined,
    events?: MinecraftBridgeEvents,
  ) {
    this.minecraftInstances = minecraftInstances;
    this.minecraftSessions = minecraftSessions;
    this.activeBotsForInstance = activeBotsForInstance;
    this.events = events ?? null;
  }

  ensureMcBridgeServer(): JnbotMcBridgeServer {
    const server = startMcBridgeServer();
    if (!this.mcBridgeWired) {
      this.mcBridgeWired = true;

      server.on('client-connected', (client) => {
        if (client.instanceId) {
          this.minecraftInstances.associateClient(
            client.instanceId,
            client.clientId,
          );
        }

        for (const event of this.mcClientEventSubscriptions.listSubscribedEventsForClient(
          client.clientId,
        )) {
          const ok = server.sendCommand(
            client.clientId,
            'mc.events.subscribe',
            { event },
          );
          console.info('[McBridge][MC_EVENTS] resubscribe on reconnect', {
            clientId: client.clientId,
            event,
            ok,
          });
        }
        for (const event of this.systemClientEventSubscriptions.get(
          client.clientId,
        ) ?? []) {
          server.sendCommand(client.clientId, 'mc.events.subscribe', { event });
        }

        this.scheduleIdleStop();
      });

      server.on('client-disconnected', (client) => {
        for (const listener of this.clientDisconnectedListeners)
          listener(client.clientId);
        this.mcClientsById.delete(client.clientId);
        this.activeBotsForInstance(client.instanceId)?.removeMinecraftBot(
          client.clientId,
        );
        this.minecraftSessions.remove(client.clientId);
        this.mcClientEventSubscriptions.unsubscribeAllForClient(
          client.clientId,
        );
        this.scheduleIdleStop();
      });

      server.on('client-event', (client, event) => {
        for (const listener of this.rawClientEventListeners)
          listener(client, event);
        if (event.name === 'mc.session.joined') {
          const data =
            typeof event.data === 'object' && event.data !== null
              ? (event.data as Record<string, unknown>)
              : null;

          const serverAddress =
            typeof data?.serverAddress === 'string'
              ? data.serverAddress
              : 'unknown';

          const serverKind =
            data?.serverKind === 'singleplayer' ||
            data?.serverKind === 'multiplayer' ||
            data?.serverKind === 'unknown'
              ? (data.serverKind as 'singleplayer' | 'multiplayer' | 'unknown')
              : 'unknown';

          this.minecraftSessions.upsertJoined({
            clientId: client.clientId,
            username: client.username,
            uuid: client.uuid,
            instanceId: client.instanceId,
            serverAddress,
            serverKind,
          });

          this.activeBotsForInstance(client.instanceId)?.upsertMinecraftBot({
            clientId: client.clientId,
            instanceId: client.instanceId,
            username: client.username,
            uuid: client.uuid,
            version: client.mcVersion,
            status: 'connected',
          });
          return;
        }

        if (event.name === 'mc.session.left') {
          this.minecraftSessions.remove(client.clientId);
          this.activeBotsForInstance(client.instanceId)?.removeMinecraftBot(
            client.clientId,
          );
          this.scheduleIdleStop();
          return;
        }

        this.mcClientEventSubscriptions.publish(client.clientId, event);
        this.events?.handle(server, client, event);
      });
    }

    return server;
  }

  getMcBridgeServer(): JnbotMcBridgeServer | null {
    return getMcBridgeServer();
  }

  onRawClientEvent(listener: RawClientEventListener): () => void {
    this.rawClientEventListeners.add(listener);
    return () => this.rawClientEventListeners.delete(listener);
  }

  onClientDisconnected(listener: (clientId: string) => void): () => void {
    this.clientDisconnectedListeners.add(listener);
    return () => this.clientDisconnectedListeners.delete(listener);
  }

  subscribeSystemClientEvent(clientId: string, event: McClientEventName): void {
    const events =
      this.systemClientEventSubscriptions.get(clientId) ?? new Set();
    if (events.has(event)) return;
    events.add(event);
    this.systemClientEventSubscriptions.set(clientId, events);
    this.ensureMcBridgeServer().sendCommand(clientId, 'mc.events.subscribe', {
      event,
    });
  }

  unsubscribeSystemClientEvent(
    clientId: string,
    event: McClientEventName,
  ): void {
    const events = this.systemClientEventSubscriptions.get(clientId);
    if (!events?.delete(event)) return;
    if (events.size === 0) this.systemClientEventSubscriptions.delete(clientId);
    if (
      this.mcClientEventSubscriptions
        .listSubscribedEventsForClient(clientId)
        .includes(event)
    )
      return;
    this.ensureMcBridgeServer().sendCommand(clientId, 'mc.events.unsubscribe', {
      event,
    });
  }


  subscribeClientEvent(script: Script_, clientId: string, event: McClientEventName): void {
    this.ensureMcBridgeServer();
    this.mcClientEventSubscriptions.subscribe(script, clientId, event);
  }

  unsubscribeClientEvent(
    script: Script_,
    clientId: string,
    event: McClientEventName,
  ): void {
    this.mcClientEventSubscriptions.unsubscribe(script, clientId, event);
  }

  unsubscribeAllClientEventsForScript(instanceId: number): void {
    this.mcClientEventSubscriptions.unsubscribeAllForScript(instanceId);
  }

  getClient(clientId: string): McClient {
    const server = this.ensureMcBridgeServer();

    const connected = server
      .listClients()
      .some((client) => client.clientId === clientId);
    if (!connected) {
      throw new Error(`Minecraft client not connected: ${clientId}`);
    }

    const existing = this.mcClientsById.get(clientId);
    if (existing) return existing;

    const created = new McClient(server, clientId);
    this.mcClientsById.set(clientId, created);
    return created;
  }

  getClients(): {
    username: string;
    clientId: string;
    mcVersion: string | undefined;
  }[] {
    const server = this.ensureMcBridgeServer();
    return server.listClients().map((client) => ({
      username: client.username ?? '',
      clientId: client.clientId,
      mcVersion: client.mcVersion,
    }));
  }

  scheduleIdleStop(): void {
    if (this.mcBridgeIdleStopTimer) {
      clearTimeout(this.mcBridgeIdleStopTimer);
      this.mcBridgeIdleStopTimer = null;
    }

    const server = getMcBridgeServer();
    if (!server) return;
    if (server.listClients().length > 0) return;
    if (server.listManagedServers().length > 0) return;
    if (this.minecraftInstances.hasRunning()) return;

    this.mcBridgeIdleStopTimer = setTimeout(() => {
      const current = getMcBridgeServer();
      if (!current) return;
      if (current.listClients().length > 0) return;
      if (current.listManagedServers().length > 0) return;
      if (this.minecraftInstances.hasRunning()) return;

      stopMcBridgeServer();
      this.mcBridgeWired = false;
    }, 30_000);
  }
}

export default MinecraftBridgeManager;
