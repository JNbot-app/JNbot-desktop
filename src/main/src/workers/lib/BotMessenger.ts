import type { Address, MessageEnvelope } from '../../../../common/messaging';
import { workerBotAddress } from '../../../../common/messaging';
import type { Bot } from '../workerTypes';
import { WorkerMessenger } from './WorkerMessenger';

export interface BotSubscriptionOptions {
  throttle?: number;
  ignorePrevious?: boolean;
}

interface ClientSubscription {
  readonly options: Required<BotSubscriptionOptions>;
  items: unknown[];
  timer?: ReturnType<typeof setTimeout>;
}

type BotActionMap = Record<string, (...args: unknown[]) => unknown>;

/** Owns all message handling and client subscriptions for one live bot. */
export class BotMessenger extends WorkerMessenger {
  private readonly clients = new Map<string, Map<Address, ClientSubscription>>();
  private readonly subscriptionListeners = new Map<string, Set<() => void>>();
  private readonly additionalSubscriptionListeners = new Map<string, Set<(address: Address) => void>>();
  private readonly unsubscriptionListeners = new Map<string, Set<() => void>>();

  constructor(
    profileId: number,
    scriptId: number,
    private readonly bot: Bot,
  ) {
    super(workerBotAddress(profileId, scriptId, bot.botId), profileId, scriptId);
    this.sub('BOT_ACTION', this.address, async (payload) => {
      const action = payload as { action?: unknown; data?: unknown };
      if (!action || typeof action.action !== 'string')
        throw new TypeError('Invalid bot action');
      const actions = (this.bot as unknown as { actions?: BotActionMap }).actions;
      const handler = actions?.[action.action];
      if (typeof handler !== 'function') {
        console.warn(
          `Action ${action.action} not found in bot actions for bot ${this.bot.botId}`,
        );
        return undefined;
      }
      const args = Array.isArray(action.data) ? action.data : [action.data];
      return await handler.apply(this.bot, args);
    });
  }

  protected override onSubscribe(message: MessageEnvelope): void {
    const subscribers = this.clients.get(message.event) ?? new Map();
    const wasEmpty = subscribers.size === 0;
    const existing = subscribers.get(message.from);
    if (existing?.timer) clearTimeout(existing.timer);
    subscribers.set(message.from, {
      options: this.options(message.data),
      items: [],
    });
    this.clients.set(message.event, subscribers);
    if (wasEmpty) {
      for (const listener of this.subscriptionListeners.get(message.event) ?? [])
        listener();
    } else {
      for (const listener of this.additionalSubscriptionListeners.get(message.event) ?? [])
        listener(message.from);
    }
  }

  protected override onUnsubscribe(message: MessageEnvelope): void {
    const subscribers = this.clients.get(message.event);
    const subscription = subscribers?.get(message.from);
    if (!subscribers || !subscription) return;
    if (subscription.timer) clearTimeout(subscription.timer);
    subscribers.delete(message.from);
    if (subscribers.size === 0) {
      this.clients.delete(message.event);
      for (const listener of this.unsubscriptionListeners.get(message.event) ?? [])
        listener();
    }
  }

  hasSubscribers(event: string): boolean {
    return (this.clients.get(event)?.size ?? 0) > 0;
  }

  onSubscription(event: string, listener: () => void): () => void {
    const listeners = this.subscriptionListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.subscriptionListeners.set(event, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.subscriptionListeners.delete(event);
    };
  }

  onUnsubscription(event: string, listener: () => void): () => void {
    const listeners = this.unsubscriptionListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.unsubscriptionListeners.set(event, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.unsubscriptionListeners.delete(event);
    };
  }

  onAdditionalSubscription(event: string, listener: (address: Address) => void): () => void {
    const listeners = this.additionalSubscriptionListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.additionalSubscriptionListeners.set(event, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.additionalSubscriptionListeners.delete(event);
    };
  }

  publishTo(event: string, address: Address, data: unknown): void {
    if (this.clients.get(event)?.has(address)) this.send(event, address, [data]);
  }

  publish(event: string, data: unknown): void {
    for (const [address, subscription] of this.clients.get(event) ?? []) {
      if (subscription.options.throttle === 0) {
        this.send(event, address, [data]);
        continue;
      }
      if (subscription.options.ignorePrevious) subscription.items.length = 0;
      subscription.items.push(data);
      if (subscription.timer) continue;
      subscription.timer = setTimeout(() => {
        subscription.timer = undefined;
        const items = subscription.items.splice(0);
        if (items.length > 0) this.send(event, address, items);
      }, subscription.options.throttle);
    }
  }

  override async close(): Promise<void> {
    for (const subscribers of this.clients.values()) {
      for (const subscription of subscribers.values()) {
        if (subscription.timer) clearTimeout(subscription.timer);
      }
    }
    this.clients.clear();
    this.subscriptionListeners.clear();
    this.additionalSubscriptionListeners.clear();
    this.unsubscriptionListeners.clear();
    await super.close();
  }

  private options(value: unknown): Required<BotSubscriptionOptions> {
    const options = (value ?? {}) as BotSubscriptionOptions;
    return {
      throttle:
        typeof options.throttle === 'number' && options.throttle > 0
          ? options.throttle
          : 0,
      ignorePrevious: options.ignorePrevious === true,
    };
  }
}
