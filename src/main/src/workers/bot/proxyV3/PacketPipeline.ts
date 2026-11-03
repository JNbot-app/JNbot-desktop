/**
 * The packet middleware engine.
 *
 * Every decoded packet (both directions) is wrapped in a {@link PacketContext}
 * and run through the registered handlers. Handlers may inspect, modify, drop,
 * or inject packets. The *forwarding* itself lives in the session and its
 * participants — the pipeline only runs handlers and reports the resulting intent.
 *
 * By default a packet is forwarded as
 * the original raw bytes (`writeRaw`), so the per-version protocol schema is
 * never exercised on the serialize path. We only re-encode (`write`) when a
 * handler actually changed something.
 */
import type {
  InjectedProxyPacket,
  PacketDirection,
  ProxyPacketData,
  RawPacket,
} from '../../../../../common/types/proxyApi';

export interface IPacketContextOptions<T = any> {
  name: string;
  state: string;
  direction: PacketDirection;
  data: T;
  /** the original decoded packet body, for zero-cost passthrough */
  buffer: Buffer;
  /**
   * True when the packet could not be decoded (schema gap). `data` is then
   * `null` and only raw passthrough is possible — handlers should not attempt
   * to modify it.
   */
  unparsed?: boolean;
  sessionId?: string;
  sourceParticipantId?: string;
  targetParticipantId?: string;
  sequence?: number;
  origin?: 'upstream' | 'downstream' | 'local';
}

export class PacketContext<T = any> {
  readonly name: string;
  readonly state: string;
  readonly direction: PacketDirection;
  #buffer: Buffer;
  /** True when the packet couldn't be decoded; `data` is null. */
  readonly unparsed: boolean;
  readonly sessionId?: string;
  readonly sourceParticipantId?: string;
  readonly targetParticipantId?: string;
  readonly sequence: number;
  readonly origin: 'upstream' | 'downstream' | 'local';

  #data: T;
  #raw: Buffer;
  #modified = false;
  #dropped = false;
  #injected: InjectedProxyPacket[] = [];
  #failure: {
    code: 'handler_error' | 'async_handler' | 'serialization_error';
    message: string;
  } | null = null;

  constructor({
    name,
    state,
    direction,
    data,
    buffer,
    unparsed,
    sessionId,
    sourceParticipantId,
    targetParticipantId,
    sequence = 0,
    origin = direction === 's2c' ? 'upstream' : 'downstream',
  }: IPacketContextOptions<T>) {
    this.name = name;
    this.state = state;
    this.direction = direction;
    this.#data = data;
    this.#buffer = buffer;
    this.#raw = buffer;
    this.unparsed = unparsed ?? false;
    this.sessionId = sessionId;
    this.sourceParticipantId = sourceParticipantId;
    this.targetParticipantId = targetParticipantId;
    this.sequence = sequence;
    this.origin = origin;
  }

  get data(): T {
    return this.#data;
  }

  /** The raw packet body that will be forwarded, including its packet id. */
  get raw(): RawPacket {
    return Buffer.from(this.#raw);
  }

  /** Preserved input bytes. A copy prevents handlers from changing fallback output. */
  get buffer(): Buffer {
    return Buffer.from(this.#buffer);
  }

  /** Reassigning the data marks the packet as modified (it will be re-encoded). */
  set data(value: T) {
    this.#data = value;
    this.#modified = true;
  }

  /** Call after mutating `data` in place so the change is re-encoded. */
  markModified(): this {
    this.#modified = true;
    return this;
  }

  /** Replace this packet with raw bytes. Works when decoding failed. */
  replaceRaw(raw: RawPacket): this {
    this.#raw = Buffer.from(raw);
    this.#modified = false;
    return this;
  }

  get isModified(): boolean {
    return this.#modified;
  }

  /** Prevent this packet from being forwarded. */
  drop(): this {
    this.#dropped = true;
    return this;
  }

  get isDropped(): boolean {
    return this.#dropped;
  }

  /** Queue an extra packet to be sent to the same target right after this one. */
  inject(name: string, data: ProxyPacketData): this {
    this.#injected.push({ kind: 'parsed', name, data });
    return this;
  }

  /** Queue an extra raw packet to the same target right after this one. */
  injectRaw(raw: RawPacket): this {
    this.#injected.push({ kind: 'raw', raw: Buffer.from(raw) });
    return this;
  }

  get injected(): readonly InjectedProxyPacket[] {
    return this.#injected;
  }

  get failure(): {
    code: 'handler_error' | 'async_handler' | 'serialization_error';
    message: string;
  } | null {
    return this.#failure;
  }

  /** @internal Used by PacketPipeline to make a packet transformation atomic. */
  checkpoint(): { data: T; raw: Buffer; modified: boolean } {
    return {
      data: clonePacketValue(this.#data),
      raw: Buffer.from(this.#raw),
      modified: this.#modified,
    };
  }

  /** @internal Roll back all edits while retaining an explicit routing drop. */
  fail(
    checkpoint: { data: T; raw: Buffer; modified: boolean },
    code: 'handler_error' | 'async_handler',
    error: unknown,
  ): void {
    this.#data = checkpoint.data;
    this.#raw = checkpoint.raw;
    this.#modified = checkpoint.modified;
    this.#injected = [];
    this.#failure = {
      code,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  /** @internal Use preserved bytes after transformed output cannot serialize. */
  failSerialization(error: unknown): void {
    this.#raw = this.#buffer;
    this.#modified = false;
    this.#injected = [];
    this.#failure = {
      code: 'serialization_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  /** Internal forwarding bytes. Kept separate from `buffer`, which is original input. */
  get forwardBuffer(): Buffer {
    return this.#raw;
  }

  /** Create an isolated recipient view after session-scoped transformations. */
  fork(targetParticipantId = this.targetParticipantId): PacketContext<T> {
    const copy = new PacketContext({
      name: this.name,
      state: this.state,
      direction: this.direction,
      data: clonePacketValue(this.#data),
      buffer: Buffer.from(this.buffer),
      unparsed: this.unparsed,
      sessionId: this.sessionId,
      sourceParticipantId: this.sourceParticipantId,
      targetParticipantId,
      sequence: this.sequence,
      origin: this.origin,
    });
    if (!this.#raw.equals(this.buffer)) copy.replaceRaw(this.#raw);
    if (this.#modified) copy.markModified();
    if (this.#dropped) copy.drop();
    for (const injected of this.#injected) {
      if (injected.kind === 'parsed')
        copy.inject(injected.name, clonePacketValue(injected.data));
      else copy.injectRaw(injected.raw);
    }
    return copy;
  }
}

export type PacketHandler = (context: PacketContext) => void;

/** Wildcard key — handlers registered here see every packet. */
export const ANY_PACKET = '*';

interface HandlerRegistration {
  events: Set<string>;
  handler: PacketHandler;
  once: boolean;
  observer: boolean;
}

function clonePacketValue<T>(value: T): T {
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (Array.isArray(value)) return value.map(clonePacketValue) as T;
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value))
      copy[key] = clonePacketValue(entry);
    return copy as T;
  }
  return value;
}

export class PacketPipeline {
  #registrations: HandlerRegistration[] = [];

  /** True when running a packet of this name can change observable behavior. */
  hasListeners(name: string): boolean {
    return this.#registrations.some(
      ({ events }) => events.has(ANY_PACKET) || events.has(name),
    );
  }

  on(events: string | string[], handler: PacketHandler): this {
    return this.#add(events, handler, false, false);
  }

  once(events: string | string[], handler: PacketHandler): this {
    return this.#add(events, handler, true, false);
  }

  /** Register a read-only observer without enabling payload rollback copies. */
  observe(events: string | string[], handler: PacketHandler): () => void {
    this.#add(events, handler, false, true);
    return () => this.off(events, handler);
  }

  off(events: string | string[], handler: PacketHandler): this {
    const removedEvents = new Set(Array.isArray(events) ? events : [events]);
    for (const registration of this.#registrations) {
      if (registration.handler !== handler) continue;
      for (const event of removedEvents) registration.events.delete(event);
    }
    this.#registrations = this.#registrations.filter(
      (registration) => registration.events.size > 0,
    );
    return this;
  }

  /**
   * Run every matching handler against the context. Handlers always all run —
   * even if one drops the packet — so observers such as debugging see the
   * full stream. A throwing (or async) handler rolls back every edit.
   */
  run(context: PacketContext): PacketContext {
    const matching = this.#registrations.filter(
      ({ events }) => events.has(ANY_PACKET) || events.has(context.name),
    );
    if (!matching.length) return context;

    const mutating = matching.filter((registration) => !registration.observer);
    const checkpoint = mutating.length ? context.checkpoint() : null;
    for (const registration of mutating) {
      if (registration.once)
        this.#registrations = this.#registrations.filter((item) => item !== registration);
      try {
        callHandler(registration.handler, context);
      } catch (error) {
        const code = error instanceof AsyncPacketHandlerError ? 'async_handler' : 'handler_error';
        context.fail(checkpoint!, code, error);
        console.error(`[proxy] packet handler error for "${context.name}":`, error);
        break;
      }
    }
    for (const registration of matching) {
      if (!registration.observer) continue;
      try {
        callHandler(registration.handler, context);
      } catch (error) {
        console.error(`[proxy] packet observer error for "${context.name}":`, error);
      }
    }
    return context;
  }

  clear(): void {
    this.#registrations = [];
  }

  #add(events: string | string[], handler: PacketHandler, once: boolean, observer: boolean): this {
    this.#registrations.push({
      events: new Set(Array.isArray(events) ? events : [events]),
      handler,
      once,
      observer,
    });
    return this;
  }
}

/** Handlers must be synchronous: a returned promise could not edit the packet in time. */
function callHandler(handler: PacketHandler, context: PacketContext): void {
  const result = handler(context) as unknown;
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
    throw new AsyncPacketHandlerError();
  }
}

/**
 * Write a context's final intent to `target`: the original bytes unless a
 * handler modified it, then any injections. A packet that no longer serializes
 * falls back to its original bytes and records the failure on the context.
 */
export function writeContext(
  target: { serializer: any; writeRaw(buffer: Buffer): void },
  ctx: PacketContext,
): void {
  let output: Buffer[];
  try {
    output = ctx.isDropped
      ? []
      : [
          ctx.isModified && !ctx.unparsed
            ? target.serializer.createPacketBuffer({ name: ctx.name, params: ctx.data })
            : ctx.forwardBuffer,
        ];
    for (const injected of ctx.injected) {
      output.push(
        injected.kind === 'parsed'
          ? target.serializer.createPacketBuffer({ name: injected.name, params: injected.data })
          : Buffer.from(injected.raw),
      );
    }
  } catch (error) {
    ctx.failSerialization(error);
    output = ctx.isDropped ? [] : [ctx.forwardBuffer];
  }
  for (const raw of output) target.writeRaw(raw);
}

class AsyncPacketHandlerError extends Error {
  constructor() {
    super('Packet handlers must be synchronous');
  }
}
