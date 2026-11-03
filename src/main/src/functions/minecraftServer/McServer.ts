import type {
  IMcServer,
  McServerApiCapabilities,
  McServerApiList,
  McServerApiStatus,
  McServerApiVersion,
  McServerEventName,
  McServerEventPayloads,
  McServerPlayer,
  McServerWorldInfo,
  McServerWorldSummary,
} from '../../../../common/minecraftServers';
import type ManagedMinecraftServerBridge from './ManagedMinecraftServerBridge';

export default class McServer implements IMcServer {
  constructor(
    private readonly bridge: ManagedMinecraftServerBridge,
    readonly id: string,
  ) {}

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.bridge.request<T>(this.id, method, params);
  }

  getStatus(): Promise<McServerApiStatus> {
    return this.request('server.status');
  }

  executeCommand(command: string) {
    return this.request<{ result: number; output: readonly string[] }>(
      'server.command.execute',
      { command },
    );
  }

  broadcast(message: string): Promise<void> {
    return this.request<void>('server.message.broadcast', { message });
  }

  getPlayers(): Promise<readonly McServerPlayer[]> {
    return this.request('server.players.list');
  }

  getPlayer(nameOrUuid: string): Promise<McServerPlayer | null> {
    return this.request('server.players.get', { player: nameOrUuid });
  }

  sendMessage(nameOrUuid: string, message: string): Promise<void> {
    return this.request<void>('server.players.message', {
      player: nameOrUuid,
      message,
    });
  }

  kickPlayer(nameOrUuid: string, reason?: string): Promise<void> {
    return this.request<void>('server.players.kick', {
      player: nameOrUuid,
      reason,
    });
  }

  getWorlds(): Promise<readonly McServerWorldSummary[]> {
    return this.request('server.worlds.list');
  }

  getWorldInfo(dimension?: string): Promise<McServerWorldInfo> {
    return this.request('server.worlds.get', { dimension });
  }

  apiList(): Promise<McServerApiList> {
    return this.request('server.api.list');
  }

  apiVersion(): Promise<McServerApiVersion> {
    return this.request('server.api.version');
  }

  apiCapabilities(): Promise<McServerApiCapabilities> {
    return this.request('server.api.capabilities');
  }

  on<E extends McServerEventName>(
    _event: E,
    _handler: (data: McServerEventPayloads[E]) => void,
  ): Promise<() => void> {
    throw new Error('Events are available from JNbot plugin workers only');
  }
}
