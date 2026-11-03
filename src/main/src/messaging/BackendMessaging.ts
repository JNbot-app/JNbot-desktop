import type { IpcMainEvent, WebContents } from 'electron';
import { ipcMain } from 'electron';
import {
  Address,
  BACKEND,
  BroadcastTarget,
  EndpointTransport,
  MessageRouter,
  Messenger,
  NetworkSocket,
  RegisteredRoute,
  RunIdAllocator,
  TransportFrame,
  clientAddress,
  decodeNetworkFrame,
  encodeNetworkFrame,
  workerScriptAddress,
} from '../../../common/messaging';
import type { Worker } from 'worker_threads';
import type ClientEvents_ from '../functions/ClientEvents';
import { invokeHandler } from '../functions/ipcHandle';
import { unrestrictedPermissions, type ClientPermissions, type ClientPrincipal } from '../../../common/clientPermissions';
import { serializeError } from '../../../common/messaging';

const FRAME_CHANNEL = 'messenger:frame';
const CONNECT_CHANNEL = 'messenger:connect';

class BackendTransport implements EndpointTransport {
  private readonly receivers = new Set<(frame: TransportFrame) => void>();
  router?: MessageRouter;

  send(frame: TransportFrame): void {
    if (!this.router) throw new Error('Message router is not initialized');
    this.router.receive(null, frame);
  }

  async sendAsync(frame: TransportFrame): Promise<void> {
    this.send(frame);
  }

  subscribe(receiver: (frame: TransportFrame) => void): () => void {
    this.receivers.add(receiver);
    return () => this.receivers.delete(receiver);
  }

  receive(frame: TransportFrame): void {
    for (const receiver of this.receivers) receiver(frame);
  }
}

export class BackendMessenger extends Messenger {
  sendToWorker(
    profileId: number,
    scriptId: number,
    event: string,
    data?: unknown,
  ): void {
    this.send(event, workerScriptAddress(profileId, scriptId), data);
  }

  publish(event: string, target: BroadcastTarget, data?: unknown): void {
    this.pub(event, target, data);
  }

  publishToProfile(profileId: number, event: string, data?: unknown): void {
    this.publishProfile(profileId, event, data);
  }
}

interface RendererRegistration {
  route: RegisteredRoute;
  dispose: () => void;
  contents: WebContents;
}

export class BackendMessagingSystem {
  readonly messenger: BackendMessenger;
  readonly router: MessageRouter;
  private readonly backendTransport = new BackendTransport();
  private readonly clientIds = new RunIdAllocator('client');
  private readonly profileIds = new RunIdAllocator('profile');
  private readonly profileByKey = new Map<string, number>();
  private readonly rendererByWebContents = new Map<
    number,
    RendererRegistration
  >();
  private readonly workerDispatchers = new Map<
    Address,
    (event: string, data: unknown) => unknown | Promise<unknown>
  >();
  private readonly remotePrincipals = new Map<Address, ClientPrincipal>();
  private remoteFrameAuthorizer?: (
    principal: ClientPrincipal,
    frame: TransportFrame,
  ) => void;
  private remoteFrameRecipientAuthorizer?: (
    principal: ClientPrincipal,
    frame: TransportFrame,
  ) => boolean;
  private installed = false;

  constructor() {
    this.messenger = new BackendMessenger(BACKEND, this.backendTransport);
    this.router = new MessageRouter((frame) =>
      this.backendTransport.receive(frame),
    );
    this.backendTransport.router = this.router;
    this.messenger.sub('worker:event', BACKEND, (payload, context) =>
      this.dispatchWorkerEvent(payload, context.origin),
    );
    this.messenger.sub('worker:action', BACKEND, (payload, context) =>
      this.dispatchWorkerEvent(payload, context.origin),
    );
  }

  installElectron(): void {
    if (this.installed) return;
    this.installed = true;
    ipcMain.on(CONNECT_CHANNEL, (event: IpcMainEvent) => {
      const registration = this.ensureRenderer(event.sender);
      event.returnValue = registration.route.address;
    });
    ipcMain.on(FRAME_CHANNEL, (event: IpcMainEvent, frame: TransportFrame) => {
      const registration = this.ensureRenderer(event.sender);
      try {
        this.router.receive(registration.route, frame);
      } catch (error) {
        console.warn('[messenger] rejected renderer frame', error);
      }
    });
  }

  profileId(key: string): number {
    const normalized = key || 'default';
    const existing = this.profileByKey.get(normalized);
    if (existing) return existing;
    const id = this.profileIds.allocate();
    this.profileByKey.set(normalized, id);
    return id;
  }

  registerWorker(
    worker: Worker,
    profileId: number,
    scriptId: number,
    dispatch?: (event: string, data: unknown) => unknown | Promise<unknown>,
  ): () => void {
    const address = workerScriptAddress(profileId, scriptId);
    const route: RegisteredRoute = {
      route: { id: `worker:${scriptId}`, address },
      address,
      send: (frame) => worker.postMessage({ __messenger: true, frame }),
      sendAsync: async (frame) =>
        worker.postMessage({ __messenger: true, frame }),
    };
    const disposeRoute = this.router.register(route);
    if (dispatch) this.workerDispatchers.set(address, dispatch);
    const receive = (message: unknown) => {
      if (
        !message ||
        typeof message !== 'object' ||
        !(message as { __messenger?: boolean }).__messenger
      )
        return;
      const frame = (message as { frame: TransportFrame }).frame;
      try {
        this.router.receive(route, frame);
      } catch (error) {
        console.warn('[messenger] rejected worker frame', error);
      }
    };
    worker.on('message', receive);
    const dispose = () => {
      worker.off('message', receive);
      disposeRoute();
      this.workerDispatchers.delete(address);
    };
    worker.once('exit', dispose);
    return dispose;
  }

  registerNetworkClient(
    socket: NetworkSocket,
  ): { address: Address; dispose: () => void } {
    const address = clientAddress(this.clientIds.allocate());
    const route: RegisteredRoute = {
      route: { id: `network:${address}`, address },
      address,
      send: (frame) => socket.send(encodeNetworkFrame(frame)),
      sendAsync: async (frame) => socket.send(encodeNetworkFrame(frame)),
    };
    const disposeRoute = this.router.register(route);
    const detach = socket.onMessage((raw) => {
      try {
        const decoded = decodeNetworkFrame(raw);
        // Authenticate at ingress without decoding or rebuilding the payload.
        const frame: TransportFrame = {
          ...decoded,
          envelope: { ...decoded.envelope, from: address },
        };
        this.router.receive(route, frame);
      } catch (error) {
        console.warn('[messenger] rejected network frame', error);
      }
    });
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      detach();
      disposeRoute();
      void socket.close?.();
    };
    return { address, dispose };
  }

  registerRemoteClient(sender: (frame: TransportFrame) => void): {
    address: Address;
    receive: (frame: TransportFrame) => void;
    dispose: () => void;
  };
  registerRemoteClient(
    sender: (frame: TransportFrame) => void,
    principal: ClientPrincipal,
  ): {
    address: Address;
    receive: (frame: TransportFrame) => void;
    dispose: () => void;
  };
  registerRemoteClient(
    sender: (frame: TransportFrame) => void,
    principal: ClientPrincipal = {
      kind: 'remote',
      subjectId: 'unknown',
      permissions: unrestrictedPermissions(),
    },
  ) {
    const address = clientAddress(this.clientIds.allocate());
    const sendAuthorized = (frame: TransportFrame) => {
      const current = this.remotePrincipals.get(address) ?? principal;
      if (this.remoteFrameRecipientAuthorizer?.(current, frame) !== false)
        sender(frame);
    };
    const route: RegisteredRoute = {
      route: { id: `remote:${address}`, address },
      address,
      send: sendAuthorized,
      sendAsync: async (frame) => sendAuthorized(frame),
    };
    const disposeRoute = this.router.register(route);
    this.remotePrincipals.set(address, principal);
    let active = true;
    return {
      address,
      receive: (frame: TransportFrame) => {
        if (!active || !frame.envelope) return;
        frame.envelope.from = address
        const current = this.remotePrincipals.get(address) ?? principal;
        try {
          this.remoteFrameAuthorizer?.(current, frame);
          this.router.receive(route, frame);
        } catch (error) {
          const envelope = frame.envelope;
          if (envelope.type === 'request' && envelope.correlationId && typeof envelope.to === 'number') {
            sender({
              envelope: {
                version: envelope.version,
                type: 'response',
                event: envelope.event,
                from: envelope.to,
                to: address,
                correlationId: envelope.correlationId,
                error: serializeError(error),
                data: undefined,
              },
            });
          }
          console.warn(`[messenger] rejected remote frame (${frame.envelope.event}) for ${current.subjectId}`, error);
        }
      },
      dispose: () => {
        if (!active) return;
        active = false;
        this.remotePrincipals.delete(address);
        disposeRoute();
      },
    };
  }

  updateRemotePrincipalPermissions(
    address: Address,
    permissions: ClientPermissions,
  ): void {
    const principal = this.remotePrincipals.get(address);
    if (principal) {
      principal.permissions = permissions;
    }
  }

  principalForAddress(address: Address): ClientPrincipal | undefined {
    return this.remotePrincipals.get(address);
  }

  setRemoteFrameAuthorizer(
    authorizer: (principal: ClientPrincipal, frame: TransportFrame) => void,
  ): void {
    this.remoteFrameAuthorizer = authorizer;
  }

  setRemoteFrameRecipientAuthorizer(
    authorizer: (principal: ClientPrincipal, frame: TransportFrame) => boolean,
  ): void {
    this.remoteFrameRecipientAuthorizer = authorizer;
  }

  setProfileRecipientAuthorizer(
    authorizer: (principal: ClientPrincipal, profileId: number) => boolean,
  ): void {
    this.router.setRouteAuthorizer((address, target) => {
      if (target.broadcast !== 'profile-clients') return true;
      const principal = this.remotePrincipals.get(address);
      return !principal || authorizer(principal, target.profileId);
    });
  }

  bindActionDispatcher(
    dispatch: (event: string, data: unknown, origin: Address) => unknown,
  ): () => void {
    return this.messenger.sub(
      'client:action',
      BACKEND,
      async (payload, context) => {
        const message = payload as { event: string; data?: unknown };
        if (!message || typeof message.event !== 'string')
          throw new TypeError('Invalid client action');
        return dispatch(message.event, message.data, context.origin);
      },
    );
  }

  bindInvokeDispatcher(
    dispatch: (channel: string, data: unknown, origin: Address) => unknown,
  ): () => void {
    return this.messenger.sub(
      'client:invoke',
      BACKEND,
      async (payload, context) => {
        const message = payload as { channel?: unknown; data?: unknown };
        if (!message || typeof message.channel !== 'string')
          throw new TypeError('Invalid client invoke');
        return dispatch(message.channel, message.data, context.origin);
      },
    );
  }

  bindSendDispatcher(
    dispatch: (channel: string, data: unknown, origin: Address) => unknown,
  ): () => void {
    return this.messenger.sub(
      'client:send',
      BACKEND,
      async (payload, context) => {
        const message = payload as { channel?: unknown; data?: unknown };
        if (!message || typeof message.channel !== 'string')
          throw new TypeError('Invalid client send');
        return dispatch(message.channel, message.data, context.origin);
      },
    );
  }

  private dispatchWorkerEvent(
    payload: unknown,
    origin: Address,
  ): unknown | Promise<unknown> {
    const message = payload as { event?: unknown; data?: unknown };
    if (!message || typeof message.event !== 'string')
      throw new TypeError('Invalid worker event');
    const dispatch = this.workerDispatchers.get(origin);
    if (!dispatch) throw new Error(`No worker dispatcher for ${origin}`);
    return dispatch(message.event, message.data);
  }

  private ensureRenderer(contents: WebContents): RendererRegistration {
    const existing = this.rendererByWebContents.get(contents.id);
    if (existing) return existing;
    const address = clientAddress(this.clientIds.allocate());
    const route: RegisteredRoute = {
      route: { id: `renderer:${contents.id}`, address },
      address,
      send: (frame) => {
        if (!contents.isDestroyed()) contents.send(FRAME_CHANNEL, frame);
      },
      sendAsync: async (frame) => {
        if (contents.isDestroyed()) throw new Error('Renderer route is closed');
        contents.send(FRAME_CHANNEL, frame);
      },
    };
    const disposeRoute = this.router.register(route);
    const dispose = () => {
      disposeRoute();
      this.rendererByWebContents.delete(contents.id);
    };
    contents.once('destroyed', dispose);
    const registration = { route, dispose, contents };
    this.rendererByWebContents.set(contents.id, registration);
    return registration;
  }
}

export const backendMessaging = new BackendMessagingSystem();

export function bindClientEventMessaging(
  clientEvents: Promise<ClientEvents_>,
): () => void {
  backendMessaging.bindActionDispatcher(async (event, data, origin) =>
    (await clientEvents).action(event, data, undefined, origin),
  );
  backendMessaging.bindInvokeDispatcher((channel, data) =>
    invokeHandler(channel, { sockets: true, socket: null }, data),
  );
  backendMessaging.bindSendDispatcher((channel, data) =>
    ipcMain.emit(channel, { sockets: true, socket: null }, data),
  );
  const subscriptions = [
    backendMessaging.messenger.sub('profile:enable', BACKEND, async (payload, context) => {
    const profileKey = (payload as { profileKey?: unknown })?.profileKey;
    if (typeof profileKey !== 'string')
      throw new TypeError('profileKey required');
    return (await clientEvents).enableProfile(profileKey, context.origin);
    }),
    backendMessaging.messenger.sub(
    'profile:snapshot',
    BACKEND,
    async (payload, context) => {
      const profileId = (payload as { profileId?: unknown })?.profileId;
      if (!Number.isInteger(profileId))
        throw new TypeError('profileId required');
      return (await clientEvents).profileSnapshot(profileId as number, context.origin);
    },
    ),
    backendMessaging.messenger.sub(
    'profiles:runtime-summaries',
    BACKEND,
    async (_payload, context) => {
      const events = await clientEvents;
      return events.scriptHandler.getRuntimeSummaries(
        events.accessControl.allowedProfileKeys(context.origin),
      );
    },
    ),
    backendMessaging.messenger.sub(
    'client:profile-action',
    BACKEND,
    async (payload, context) => {
      const message = payload as {
        profileId?: unknown;
        event?: unknown;
        data?: unknown;
      };
      if (
        !Number.isInteger(message.profileId) ||
        typeof message.event !== 'string'
      )
        throw new TypeError('Invalid profile action');
      return (await clientEvents).profileAction(
        message.profileId as number,
        message.event,
        message.data,
        context.origin,
      );
    },
    ),
  ];
  return () => subscriptions.forEach((unsubscribe) => unsubscribe());
}
