import { Address, assertAddress, decodeAddress } from './Address';
import {
  MessageTimeoutError,
  MessengerClosedError,
  MessagingError,
} from './Errors';
import {
  BroadcastTarget,
  ProfilePublication,
  MessageEnvelope,
  MessageTarget,
  MESSAGING_PROTOCOL_VERSION,
  isBroadcastTarget,
  serializeError,
  validateEnvelope,
} from './Protocol';
import { EndpointTransport, TransportFrame } from './Transport';
import { materializeFrame } from './NetworkFrame';

export type Unsubscribe = () => void;

export interface MessageContext {
  readonly event: string;
  readonly origin: Address;
  readonly destination: MessageTarget;
  readonly correlationId?: string;
  readonly signal: AbortSignal;
  reply(data: unknown): void;
}

export type MessageHandler<T = unknown, R = unknown> = (
  data: T,
  context: MessageContext,
) => R | Promise<R>;

export interface SendOptions {
  signal?: AbortSignal;
}

export interface RequestOptions extends SendOptions {
  timeoutMs?: number;
}

export interface PubOptions {
  /** Buffer publications and flush after this many milliseconds. */
  throttleMs?: number;
  /** When throttling, discard all but the latest buffered item. */
  ignorePrevious?: boolean;
}

interface PendingRequest {
  event: string;
  expectedFrom: Address;
  timeout?: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface Subscription {
  target: MessageTarget;
  origin?: Address;
  handler: MessageHandler;
}

export class Messenger {
  private readonly subscriptions = new Map<string, Set<Subscription>>();
  private readonly subscriptionCounts = new Map<string, number>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly controllers = new Set<AbortController>();
  private readonly manualReplies = new Set<string>();
  private readonly throttleBuffers = new Map<
    string,
    { items: unknown[]; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly detachTransport: Unsubscribe;
  private sequence = 0;
  private closed = false;

  constructor(
    public readonly address: Address,
    protected readonly transport: EndpointTransport,
    private readonly defaultTimeoutMs = 30_000,
  ) {
    assertAddress(address);
    this.detachTransport = transport.subscribe(
      (frame) => void this.receive(frame),
    );
  }

  send(event: string, id: Address, data?: unknown): void {
    this.ensureOpen();
    this.transport.send({ envelope: this.envelope('send', event, id, data) });
  }

  async sendAsync(
    event: string,
    id: Address,
    data?: unknown,
    options: SendOptions = {},
  ): Promise<void> {
    this.ensureOpen();
    if (options.signal?.aborted) throw options.signal.reason;
    await this.transport.sendAsync({
      envelope: this.envelope('send', event, id, data),
    });
  }

  request<T = unknown>(
    event: string,
    id: Address,
    data?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    this.ensureOpen();
    assertAddress(id);
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    const correlationId = this.nextCorrelationId();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      // A queued operation can intentionally outlive the normal RPC timeout.
      // `0` makes that explicit while still allowing its AbortSignal to clean up.
      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(correlationId);
              reject(new MessageTimeoutError(event));
            }, timeoutMs)
          : undefined;
      this.pending.set(correlationId, {
        event,
        expectedFrom: id,
        timeout,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      options.signal?.addEventListener(
        'abort',
        () => {
          const pending = this.pending.get(correlationId);
          if (!pending) return;
          if (pending.timeout) clearTimeout(pending.timeout);
          this.pending.delete(correlationId);
          reject(options.signal?.reason);
        },
        { once: true },
      );
      try {
        this.transport.send({
          envelope: this.envelope(
            'request',
            event,
            id,
            data,
            correlationId,
            timeoutMs,
          ),
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(correlationId);
        reject(error);
      }
    });
  }

  pub(
    event: string,
    id: Address | BroadcastTarget,
    data?: unknown,
    options?: PubOptions,
  ): void {
    this.ensureOpen();
    if (typeof id === 'number') assertAddress(id);
    else if (!isBroadcastTarget(id))
      throw new TypeError('Invalid broadcast target');

    if (options?.throttleMs && options.throttleMs > 0) {
      this.throttledPub(event, id, data, options);
      return;
    }

    this.transport.send({
      envelope: this.envelope('publish', event, id, data),
    });
  }

  publishProfile<T = unknown>(
    profileId: number,
    event: string,
    data?: T,
    options?: PubOptions,
  ): void {
    this.pub(
      'profile:event',
      { broadcast: 'profile-clients', profileId },
      { profileId, event, data: data as T } satisfies ProfilePublication<T>,
      options,
    );
  }

  private throttledPub(
    event: string,
    id: Address | BroadcastTarget,
    data: unknown,
    options: PubOptions,
  ): void {
    const key = `${event}\0${JSON.stringify(id)}`;
    const existing = this.throttleBuffers.get(key);

    if (existing) {
      if (options.ignorePrevious) existing.items.pop();
      existing.items.push(data);
      return;
    }

    const buffer = {
      items: [data],
      timer: setTimeout(() => {
        this.throttleBuffers.delete(key);
        if (this.closed) return;
        this.transport.send({
          envelope: this.envelope('publish', event, id, buffer.items),
        });
      }, options.throttleMs!),
    };
    this.throttleBuffers.set(key, buffer);
  }

  sub<T = unknown, R = unknown>(
    event: string,
    id: Address | BroadcastTarget,
    handler: MessageHandler<T, R>,
    options?: unknown,
  ): Unsubscribe {
    this.ensureOpen();
    if (!event) throw new TypeError('Subscription event is required');
    if (typeof id === 'number') assertAddress(id);
    else if (!isBroadcastTarget(id))
      throw new TypeError('Invalid subscription target');
    if (typeof handler !== 'function')
      throw new TypeError('Subscription handler is required');

    const subscriptions =
      this.subscriptions.get(event) ?? new Set<Subscription>();
    // A numeric target identifies the remote publisher to subscribe to, while
    // incoming unicast frames are always delivered to this endpoint. Broadcast
    // subscriptions continue to match their broadcast destination directly.
    const subscription = {
      target: typeof id === 'number' ? this.address : id,
      origin: typeof id === 'number' && id !== this.address ? id : undefined,
      handler: handler as MessageHandler,
    };
    subscriptions.add(subscription);
    this.subscriptions.set(event, subscriptions);
    const key = this.subscriptionKey(event, id);
    const count = this.subscriptionCounts.get(key) ?? 0;
    this.subscriptionCounts.set(key, count + 1);
    if (count === 0 && (typeof id !== 'number' || id !== this.address)) {
      const to = typeof id === 'number' ? id : this.address;
      this.transport.send({
        envelope: this.envelope(
          'subscribe',
          event,
          to,
          typeof id === 'number' ? options : { target: id, options },
        ),
      });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      subscriptions.delete(subscription);
      const remaining = (this.subscriptionCounts.get(key) ?? 1) - 1;
      if (remaining > 0) this.subscriptionCounts.set(key, remaining);
      else this.subscriptionCounts.delete(key);
      if (subscriptions.size === 0) {
        this.subscriptions.delete(event);
      }
      if (
        remaining === 0 &&
        !this.closed &&
        (typeof id !== 'number' || id !== this.address)
      ) {
        const to = typeof id === 'number' ? id : this.address;
        this.transport.send({
          envelope: this.envelope(
            'unsubscribe',
            event,
            to,
            typeof id === 'number' ? undefined : { target: id },
          ),
        });
      }
    };
  }


  subscribeProfile(
    profileId: number,
    handler: MessageHandler<ProfilePublication>,
  ): Unsubscribe {
    return this.sub(
      'profile:event',
      { broadcast: 'profile-clients', profileId },
      handler as MessageHandler,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.detachTransport();
    for (const { timer } of this.throttleBuffers.values()) clearTimeout(timer);
    this.throttleBuffers.clear();
    for (const controller of this.controllers)
      controller.abort(new MessengerClosedError());
    this.controllers.clear();
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new MessengerClosedError());
    }
    this.pending.clear();
    this.subscriptions.clear();
    this.subscriptionCounts.clear();
    await this.transport.close?.();
  }

  protected envelope(
    type: MessageEnvelope['type'],
    event: string,
    to: MessageTarget,
    data: unknown,
    correlationId?: string,
    timeoutMs?: number,
  ): MessageEnvelope {
    if (!event) throw new TypeError('Message event is required');
    if (typeof to === 'number') assertAddress(to);
    return {
      version: MESSAGING_PROTOCOL_VERSION,
      type,
      event,
      to,
      from: this.address,
      correlationId,
      timeoutMs,
      data,
    };
  }

  private async receive(frame: TransportFrame): Promise<void> {
    frame = materializeFrame(frame);
    try {
      validateEnvelope(frame.envelope);
    } catch (error) {
      console.warn('[messenger] rejected frame', error);
      return;
    }
    const message = frame.envelope;
    if (message.type === 'response') {
      if (message.to === this.address) this.receiveResponse(message);
      return;
    }
    if (message.type === 'subscribe' || message.type === 'unsubscribe') {
      if (message.to === this.address) {
        if (message.type === 'subscribe') this.onSubscribe(message);
        else this.onUnsubscribe(message);
      }
      return;
    }

    const exact = this.subscriptions.get(message.event);
    const candidates = exact?.size
      ? [...exact]
      : [...(this.subscriptions.get('*') ?? [])];
    const matches = candidates.filter(
      (subscription) =>
        this.matches(subscription.target, message.to) &&
        (subscription.origin === undefined ||
          subscription.origin === message.from),
    );
    if (matches.length === 0) return;

    if (message.type === 'request') {
      await this.receiveRequest(message, matches[0]);
      return;
    }
    for (const subscription of matches) void this.invoke(subscription, message);
  }

  private receiveResponse(message: MessageEnvelope): void {
    const correlationId = message.correlationId;
    if (!correlationId) return;
    const pending = this.pending.get(correlationId);
    if (!pending) {
      const fromThisMessenger = correlationId.startsWith(
        `${this.address.toString(36)}-`,
      );
      console.warn('[messenger] ignored response', {
        correlationId,
        event: message.event,
        from: message.from,
        to: message.to,
        localAddress: this.address,
        reason:
          fromThisMessenger
            ? 'request is no longer pending (already resolved, timed out, or cancelled)'
            : 'request belongs to a previous or different messenger',
        pendingRequestCount: this.pending.size,
        responseError: message.error?.code,
      });
      return;
    }
    if (message.from !== pending.expectedFrom || message.to !== this.address) {
      console.warn(
        '[messenger] ignored response from an unexpected origin',
        correlationId,
      );
      return;
    }
    if (pending.timeout) clearTimeout(pending.timeout);
    this.pending.delete(correlationId);
    if (message.error) {
      const error = new MessagingError(
        message.error.message,
        message.error.code ?? 'REMOTE_ERROR',
      );
      error.name = message.error.name;
      if (message.error.stack) error.stack = message.error.stack;
      pending.reject(error);
    } else pending.resolve(message.data);
  }

  private async receiveRequest(
    message: MessageEnvelope,
    subscription: Subscription,
  ): Promise<void> {
    try {
      const data = await this.invoke(subscription, message);
      if (this.manualReplies.delete(message.correlationId!)) return;
      this.respond(message, data);
    } catch (error) {
      if (this.manualReplies.delete(message.correlationId!)) return;
      this.respond(message, undefined, serializeError(error));
    }
  }

  private async invoke(
    subscription: Subscription,
    message: MessageEnvelope,
  ): Promise<unknown> {
    const controller = new AbortController();
    this.controllers.add(controller);
    let replied = false;
    const context: MessageContext = {
      event: message.event,
      origin: message.from,
      destination: message.to,
      correlationId: message.correlationId,
      signal: controller.signal,
      reply: (data) => {
        if (message.type !== 'request')
          throw new TypeError('Only requests can be replied to');
        if (replied) throw new TypeError('Request already replied to');
        replied = true;
        this.manualReplies.add(message.correlationId!);
        this.respond(message, data);
      },
    };
    try {
      return await subscription.handler(message.data, context);
    } finally {
      this.controllers.delete(controller);
    }
  }

  private respond(
    request: MessageEnvelope,
    data: unknown,
    error?: ReturnType<typeof serializeError>,
  ): void {
    this.transport.send({
      envelope: {
        version: MESSAGING_PROTOCOL_VERSION,
        type: 'response',
        event: request.event,
        to: request.from,
        from: request.to as Address,
        correlationId: request.correlationId,
        error,
        data,
      },
    });
  }

  private matches(
    subscription: MessageTarget,
    destination: MessageTarget,
  ): boolean {
    if (typeof subscription === 'number' && typeof destination === 'number') {
      if (subscription === destination) return true;
      const local = decodeAddress(subscription);
      const target = decodeAddress(destination);
      return (
        local.kind === 'worker' &&
        target.kind === 'worker' &&
        local.profileId === target.profileId &&
        local.scriptId !== 0 &&
        local.scriptId === target.scriptId &&
        local.leafId === 0
      );
    }
    if (typeof subscription !== 'number' && typeof destination !== 'number') {
      if (subscription.broadcast !== destination.broadcast) return false;
      return (
        !('profileId' in subscription) ||
        ('profileId' in destination &&
          subscription.profileId === destination.profileId)
      );
    }
    return false;
  }

  protected onSubscribe(message: MessageEnvelope): void {}
  protected onUnsubscribe(message: MessageEnvelope): void {}

  private nextCorrelationId(): string {
    this.sequence += 1;
    return `${this.address.toString(36)}-${Date.now().toString(36)}-${this.sequence.toString(36)}`;
  }

  private subscriptionKey(event: string, target: MessageTarget): string {
    return `${event}\0${typeof target === 'number' ? target : JSON.stringify(target)}`;
  }

  private ensureOpen(): void {
    if (this.closed) throw new MessengerClosedError();
  }
}
