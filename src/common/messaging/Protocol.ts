import { Address, assertAddress } from './Address';

export const MESSAGING_PROTOCOL_VERSION = 1 as const;

export type MessageType =
  | 'send'
  | 'request'
  | 'response'
  | 'publish'
  | 'subscribe'
  | 'unsubscribe';

export type BroadcastTarget =
  | { readonly broadcast: 'clients' }
  | { readonly broadcast: 'workers' }
  | { readonly broadcast: 'all' }
  | { readonly broadcast: 'profile-clients'; readonly profileId: number }
  | { readonly broadcast: 'profile-workers'; readonly profileId: number };

export type MessageTarget = Address | BroadcastTarget;

export interface ProfilePublication<T = unknown> {
  readonly profileId: number;
  readonly event: string;
  readonly data: T;
}

export interface BroadcastSubscriptionControl {
  readonly target: BroadcastTarget;
  readonly options?: unknown;
}

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

export interface MessageEnvelope<T = unknown> {
  version: typeof MESSAGING_PROTOCOL_VERSION;
  type: MessageType;
  event: string;
  to: MessageTarget;
  from: Address;
  correlationId?: string;
  timeoutMs?: number;
  error?: SerializedError;
  data: T;
}

export function isBroadcastTarget(value: unknown): value is BroadcastTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as { broadcast?: unknown; profileId?: unknown };
  if (
    target.broadcast === 'clients' ||
    target.broadcast === 'workers' ||
    target.broadcast === 'all'
  ) {
    return target.profileId === undefined;
  }
  return (
    (target.broadcast === 'profile-clients' ||
      target.broadcast === 'profile-workers') &&
    Number.isInteger(target.profileId) &&
    Number(target.profileId) > 0
  );
}

export function validateEnvelope(
  value: unknown,
): asserts value is MessageEnvelope {
  if (!value || typeof value !== 'object')
    throw new TypeError('Message frame must be an object');
  const frame = value as Partial<MessageEnvelope>;
  if (frame.version !== MESSAGING_PROTOCOL_VERSION)
    throw new TypeError('Unsupported messaging protocol version');
  if (
    ![
      'send',
      'request',
      'response',
      'publish',
      'subscribe',
      'unsubscribe',
    ].includes(String(frame.type))
  ) {
    throw new TypeError('Unknown message type');
  }
  if (typeof frame.event !== 'string' || frame.event.length === 0)
    throw new TypeError('Message event is required');
  assertAddress(frame.from as number);
  if (typeof frame.to === 'number') assertAddress(frame.to);
  else if (!isBroadcastTarget(frame.to))
    throw new TypeError('Invalid message target');
  if (frame.type !== 'publish' && typeof frame.to !== 'number') {
    throw new TypeError('Only publications may use broadcast targets');
  }
  if (
    (frame.type === 'request' || frame.type === 'response') &&
    !frame.correlationId
  ) {
    throw new TypeError(`${frame.type} requires a correlationId`);
  }
  if (
    frame.timeoutMs !== undefined &&
    (!Number.isFinite(frame.timeoutMs) || frame.timeoutMs < 0)
  ) {
    throw new TypeError('Invalid timeoutMs');
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const coded = error as Error & { code?: string };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: coded.code,
    };
  }
  return { name: 'Error', message: String(error) };
}
