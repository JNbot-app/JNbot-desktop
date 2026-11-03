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
import workerScript from './workerScript';

export default class WorkerMcServer implements IMcServer {
  private static wired = false;
  private static readonly instances = new Set<WorkerMcServer>();
  private readonly handlers = new Map<
    McServerEventName,
    Set<(data: any) => void>
  >();

  constructor(
    readonly id: string,
  ) {
    WorkerMcServer.instances.add(this);
    if (!WorkerMcServer.wired) {
      WorkerMcServer.wired = true;
      workerScript.onMessage('MC_SERVER_EVENT', (payload: unknown) => {
        if (!payload || typeof payload !== 'object') return;
        const event = payload as {
          serverId?: unknown;
          name?: unknown;
          data?: unknown;
        };
        if (
          typeof event.serverId !== 'string' ||
          typeof event.name !== 'string'
        )
          return;
        for (const instance of WorkerMcServer.instances) {
          if (instance.id !== event.serverId) continue;
          const handlers = instance.handlers.get(
            event.name as McServerEventName,
          );
          for (const handler of handlers ?? []) handler(event.data);
        }
      });
    }
  }

  private call<T>(method: string, ...args: unknown[]): Promise<T> {
    return workerScript.sendAsync('MC_SERVER_METHOD', {
      serverId: this.id,
      method,
      args,
    });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.call('request', method, params);
  }

  getStatus(): Promise<McServerApiStatus> {
    return this.call('getStatus');
  }

  executeCommand(command: string) {
    return this.call<{ result: number; output: readonly string[] }>(
      'executeCommand',
      command,
    );
  }

  broadcast(message: string): Promise<void> {
    return this.call('broadcast', message);
  }

  getPlayers(): Promise<readonly McServerPlayer[]> {
    return this.call('getPlayers');
  }

  getPlayer(nameOrUuid: string): Promise<McServerPlayer | null> {
    return this.call('getPlayer', nameOrUuid);
  }

  sendMessage(nameOrUuid: string, message: string): Promise<void> {
    return this.call('sendMessage', nameOrUuid, message);
  }

  kickPlayer(nameOrUuid: string, reason?: string): Promise<void> {
    return this.call('kickPlayer', nameOrUuid, reason);
  }

  getWorlds(): Promise<readonly McServerWorldSummary[]> {
    return this.call('getWorlds');
  }

  getWorldInfo(dimension?: string): Promise<McServerWorldInfo> {
    return this.call('getWorldInfo', dimension);
  }

  apiList(): Promise<McServerApiList> {
    return this.call('apiList');
  }

  apiVersion(): Promise<McServerApiVersion> {
    return this.call('apiVersion');
  }

  apiCapabilities(): Promise<McServerApiCapabilities> {
    return this.call('apiCapabilities');
  }

  async on<E extends McServerEventName>(
    event: E,
    handler: (data: McServerEventPayloads[E]) => void,
  ): Promise<() => void> {
    let handlers = this.handlers.get(event);
    const first = !handlers?.size;
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(event, handlers);
    }
    handlers.add(handler);
    if (first)
      workerScript.send('SUBSCRIBE_MC_SERVER_EVENT', {
        serverId: this.id,
        event,
      });
    return async () => {
      const current = this.handlers.get(event);
      current?.delete(handler);
      if (current?.size) return;
      this.handlers.delete(event);
      workerScript.send('UNSUBSCRIBE_MC_SERVER_EVENT', {
        serverId: this.id,
        event,
      });
    };
  }
}
