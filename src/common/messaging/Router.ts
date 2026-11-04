import {
  Address,
  BACKEND,
  decodeAddress,
  workerScriptAddress,
} from './Address';
import { RouteUnavailableError } from './Errors';
import {
  BroadcastTarget,
  isBroadcastTarget,
  MessageEnvelope,
  MESSAGING_PROTOCOL_VERSION,
  validateEnvelope,
} from './Protocol';
import { TransportFrame, TransportRoute } from './Transport';

export interface RegisteredRoute {
  readonly route: TransportRoute;
  readonly address: Address;
  send(frame: TransportFrame): void;
  sendAsync(frame: TransportFrame): Promise<void>;
}

interface ReverseRoute {
  route: RegisteredRoute;
  requester: Address;
  destination: Address;
  expiresAt: number;
}

export class MessageRouter {
  private readonly routes = new Map<Address, RegisteredRoute>();
  private readonly reverseRoutes = new Map<string, ReverseRoute>();
  private readonly subscriptions = new Map<string, Set<Address>>();
  private routeAuthorizer?: (address: Address, target: BroadcastTarget) => boolean;

  constructor(
    private readonly backendReceiver: (frame: TransportFrame) => void,
    private readonly requestTtlMs = 30_000,
  ) {}

  register(route: RegisteredRoute): () => void {
    if (route.address === BACKEND)
      throw new TypeError(
        'The backend address is local and cannot be registered',
      );
    if (this.routes.has(route.address))
      throw new TypeError(`Duplicate route: ${route.address}`);
    this.routes.set(route.address, route);
    return () => this.unregister(route.address);
  }

  unregister(address: Address): void {
    this.routes.delete(address);
    for (const subscribers of this.subscriptions.values())
      subscribers.delete(address);
    for (const [id, reverse] of this.reverseRoutes) {
      if (reverse.route.address === address || reverse.destination === address) {
        this.reverseRoutes.delete(id);
      }
    }
  }

  setRouteAuthorizer(authorizer: (address: Address, target: BroadcastTarget) => boolean): void {
    this.routeAuthorizer = authorizer;
  }

  receive(ingress: RegisteredRoute | null, frame: TransportFrame): void {
    validateEnvelope(frame.envelope);
    const envelope = frame.envelope;
    this.expireReverseRoutes();

    if (ingress && !this.originAllowed(ingress.address, envelope.from)) {
      throw new TypeError(`Forged message origin: ${envelope.from}`);
    }
    if (envelope.type === 'subscribe' || envelope.type === 'unsubscribe') {
      if (!ingress) return;
      this.updateSubscription(envelope, ingress.address);
      if (typeof envelope.to === 'number' && envelope.to !== ingress.address) {
        const target = this.resolveRoute(envelope.to);
        if (target) target.send(frame);
      }
      return;
    }
    if (envelope.type === 'response') {
      this.routeResponse(envelope, frame);
      return;
    }
    if (envelope.type === 'request' && envelope.correlationId && ingress) {
      if (this.reverseRoutes.has(envelope.correlationId))
        throw new TypeError('Duplicate correlationId');
      if (typeof envelope.to !== 'number')
        throw new TypeError('Requests cannot broadcast');
      const ttl =
        envelope.timeoutMs !== undefined
          ? envelope.timeoutMs
          : this.requestTtlMs;
      this.reverseRoutes.set(envelope.correlationId, {
        route: ingress,
        requester: ingress.address,
        destination: envelope.to,
        expiresAt: ttl === 0 ? 0 : Date.now() + ttl + 5_000,
      });
    }
    if (envelope.type === 'publish' && typeof envelope.to !== 'number') {
      this.routeBroadcast(envelope.to, envelope.event, frame, ingress?.address);
      return;
    }
    if (typeof envelope.to !== 'number')
      throw new TypeError('Invalid unicast target');
    if (envelope.to === BACKEND) {
      this.backendReceiver(frame);
      return;
    }
    const target = this.resolveRoute(envelope.to);
    if (!target) {
      if (envelope.type === 'request' && envelope.correlationId) {
        this.returnRouteError(envelope, ingress, `No route for ${envelope.to}`);
      }
      return;
    }
    target.send(frame);
  }

  private resolveRoute(address: Address): RegisteredRoute | undefined {
    const exact = this.routes.get(address);
    if (exact) return exact;
    const decoded = decodeAddress(address);
    if (decoded.kind === 'worker' && decoded.scriptId !== 0) {
      return this.routes.get(
        workerScriptAddress(decoded.profileId, decoded.scriptId),
      );
    }
    return undefined;
  }

  private originAllowed(routeAddress: Address, origin: Address): boolean {
    if (routeAddress === origin) return true;
    const route = decodeAddress(routeAddress);
    const claimed = decodeAddress(origin);
    return (
      route.kind === 'worker' &&
      claimed.kind === 'worker' &&
      route.profileId === claimed.profileId &&
      route.scriptId !== 0 &&
      route.scriptId === claimed.scriptId &&
      route.leafId === 0
    );
  }

  private routeResponse(
    envelope: MessageEnvelope,
    frame: TransportFrame,
  ): void {
    if (envelope.to === BACKEND) {
      this.backendReceiver(frame);
      return;
    }
    const correlationId = envelope.correlationId;
    if (!correlationId) return;
    const reverse = this.reverseRoutes.get(correlationId);
    if (!reverse) return;
    if (
      envelope.from !== reverse.destination ||
      envelope.to !== reverse.requester
    ) {
      throw new TypeError(
        'Response origin or destination does not match its request',
      );
    }
    this.reverseRoutes.delete(correlationId);
    reverse.route.send(frame);
  }

  private routeBroadcast(
    target: BroadcastTarget,
    event: string,
    frame: TransportFrame,
    ingress?: Address,
  ): void {
    const subscribers = this.subscriptions.get(
      this.subscriptionKey(event, target),
    );
    if (!subscribers) return;
    for (const address of subscribers) {
      if (address === ingress || !this.broadcastMatches(target, address))
        continue;
      if (this.routeAuthorizer && !this.routeAuthorizer(address, target))
        continue;
      this.routes.get(address)?.send(frame);
    }
  }

  private broadcastMatches(target: BroadcastTarget, address: Address): boolean {
    const decoded = decodeAddress(address);
    if (target.broadcast === 'all') return true;
    if (target.broadcast === 'clients') return decoded.kind === 'client';
    if (target.broadcast === 'workers') return decoded.kind === 'worker';
    if (target.broadcast === 'profile-clients') {
      // Profile membership is represented by the exact scoped subscription,
      // not by one mutable profile field on the client route.
      return decoded.kind === 'client';
    }
    return decoded.kind === 'worker' && decoded.profileId === target.profileId;
  }

  private updateSubscription(
    envelope: MessageEnvelope,
    address: Address,
  ): void {
    const control = envelope.data as { target?: unknown } | undefined;
    const requested = control?.target;
    // Direct publisher subscriptions are forwarded to the publisher and do
    // not participate in router broadcasts.
    // Older clients subscribed to their own address without a control payload;
    // keep that protocol working by scoping the subscription to its route kind.
    const target = isBroadcastTarget(requested)
      ? requested
      : (() => {
          const kind = decodeAddress(address).kind;
          if (kind === 'client') return { broadcast: 'clients' } as const;
          if (kind === 'worker') return { broadcast: 'workers' } as const;
          return undefined;
        })();
    if (!target) return;
    const key = this.subscriptionKey(envelope.event, target);
    const subscribers = this.subscriptions.get(key) ?? new Set<Address>();
    if (envelope.type === 'subscribe') subscribers.add(address);
    else subscribers.delete(address);
    if (subscribers.size === 0) this.subscriptions.delete(key);
    else this.subscriptions.set(key, subscribers);
  }

  private subscriptionKey(event: string, target: BroadcastTarget): string {
    return `${event}\0${JSON.stringify(target)}`;
  }

  private returnRouteError(
    request: MessageEnvelope,
    ingress: RegisteredRoute | null,
    message: string,
  ): void {
    if (!ingress) return;
    this.reverseRoutes.delete(request.correlationId!);
    const error = new RouteUnavailableError(message);
    ingress.send({
      envelope: {
        version: MESSAGING_PROTOCOL_VERSION,
        type: 'response',
        event: request.event,
        to: request.from,
        from: request.to as Address,
        correlationId: request.correlationId,
        error: { name: error.name, message: error.message, code: error.code },
        data: undefined,
      },
    });
  }

  private expireReverseRoutes(): void {
    const now = Date.now();
    for (const [id, reverse] of this.reverseRoutes) {
      if (reverse.expiresAt > 0 && reverse.expiresAt <= now) {
        this.reverseRoutes.delete(id);
      }
    }
  }
}
