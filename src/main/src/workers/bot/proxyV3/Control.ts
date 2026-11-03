/**
 * The private `jnbot:proxy` channel to one JNbot participant: a bot, or a client
 * running the JNbot mod. The participant announces itself after `enable`; bots
 * resolve their state provider through the app (`botId` + token), the mod
 * streams its capture inline over the channel. The link belongs to the
 * connection, so it survives moving between sessions. Control frames are never
 * forwarded upstream.
 */
import { randomUUID } from 'node:crypto';
import { states } from 'minecraft-protocol';

import { raceAbort } from './Barrier';
import { TypedEventEmitter } from './TypedEventEmitter';
import type { Participant } from './Participant';
import type { ProxyRuntimeConfig } from './internalConfig';
import type { ProxyStateProvider } from '../../../../../common/types/proxyApi';

const { CONTROL_CHANNEL, getBotStateProvider } = require('../botProxy');

/** A reply the participant streams back, keyed by request id. */
interface Pending {
  resolve(value: string): void;
  reject(error: Error): void;
  parts: string[];
}

type ControlEvents = {
  /** The participant's provider or its readiness changed. */
  provider: [];
  /** A message the server handles, e.g. `{ type: 'join', sessionId }` from the mod. */
  request: [message: Record<string, unknown>];
};

export class Control extends TypedEventEmitter<ControlEvents> {
  readonly #nonce = randomUUID();
  #linked = false;
  #botId?: number;
  /** A bot's world model is complete; reset while it reconfigures. */
  #stateReady = false;
  #pending = new Map<string, Pending>();

  constructor(
    private readonly participant: Participant,
    private readonly resolveBot?: ProxyRuntimeConfig['resolveBotStateProvider'],
  ) {
    super();
  }

  get linked(): boolean {
    return this.#linked;
  }

  /** Bots report when their world model is complete; other providers are always ready. */
  get stateReady(): boolean {
    return this.#botId === undefined || this.#stateReady;
  }

  /**
   * Offer the channel; plain clients ignore the unknown channel. Only offered
   * in play (where the mod listens), again on every return to play until
   * answered. The mod forgets the link when it leaves play (a reconfiguration
   * or a move), so it is offered the same link again.
   */
  offer(): void {
    if (this.participant.phase !== states.PLAY) return;
    if (this.#linked && this.participant.kind !== 'client') return;
    this.#write({ type: 'enable', nonce: this.#nonce });
  }

  /** Handle a c2s custom_payload. Returns true when it belonged to this channel. */
  accept(packet: { channel?: string; data?: Buffer }): boolean {
    if (packet?.channel !== CONTROL_CHANNEL) return false;
    let message: any;
    try {
      message = JSON.parse(Buffer.from(packet.data ?? []).toString('utf8'));
    } catch {
      return true;
    }
    if (message?.nonce !== this.#nonce) return true;
    if (this.#botId !== undefined && message.botId !== this.#botId) return true;
    const pending = this.#pending.get(message.id);

    switch (message.type) {
      case 'ready':
        this.#linked = true;
        if (message.provider === 'inline') {
          this.participant.kind = 'client';
          this.participant.provider = this.#inlineProvider();
          this.emit('provider');
        } else if (Number.isInteger(message.botId)) {
          this.#botId = message.botId;
          void this.#resolveBotProvider(message.token);
        }
        break;
      case 'state_ready':
      case 'state_reset':
        this.#stateReady = message.type === 'state_ready';
        this.emit('provider');
        break;
      case 'barrier':
      case 'capture_end':
        pending?.resolve(pending.parts.join(''));
        break;
      case 'capture_part':
        if (typeof message.data === 'string') pending?.parts.push(message.data);
        break;
      case 'capture_error':
        pending?.reject(new Error(String(message.message ?? 'Capture failed')));
        break;
      default:
        this.emit('request', message);
    }
    return true;
  }

  freeze(): void {
    this.send('freeze');
  }

  resume(): void {
    this.send('resume');
  }

  /** Mirror the driver's movement/held slot onto a frozen participant. */
  sync(player: Record<string, unknown>): void {
    this.send('state_sync', { player });
  }

  /**
   * Round trip through the participant's packet handling. Unlike a keep-alive
   * (answered at once by bots and vanilla clients), the reply proves it
   * processed every packet written before it.
   */
  async barrier(signal: AbortSignal): Promise<void> {
    await this.#request('barrier', signal, 'Barrier timed out');
  }

  /** Send a control message. False when the participant has not linked. */
  send(type: string, extra: Record<string, unknown> = {}): boolean {
    if (!this.#linked) return false;
    return this.#write({ type, nonce: this.#nonce, botId: this.#botId, ...extra });
  }

  close(): void {
    for (const pending of this.#pending.values())
      pending.reject(new Error(`${this.participant.username} left`));
    this.#pending.clear();
  }

  /** The mod exports its state as raw packets, streamed in parts over this channel. */
  #inlineProvider(): ProxyStateProvider {
    return {
      capture: async (signal) => {
        const raw = JSON.parse(await this.#request('capture', signal, 'State capture timed out'));
        const bytes = (value: string) => Buffer.from(value, 'base64');
        return {
          protocol: raw.protocol,
          handshake: {
            configuration: raw.handshake.configuration.map(bytes),
            login: bytes(raw.handshake.login),
            respawn: raw.handshake.respawn && bytes(raw.handshake.respawn),
            singletons: raw.handshake.singletons.map(bytes),
          },
          bootstrap: raw.bootstrap.map(bytes),
        };
      },
    };
  }

  #request(type: string, signal: AbortSignal, timeout: string): Promise<string> {
    const id = randomUUID();
    const reply = new Promise<string>((resolve, reject) =>
      this.#pending.set(id, { resolve, reject, parts: [] }),
    );
    if (!this.send(type, { id })) {
      this.#pending.delete(id);
      return Promise.reject(new Error(`${this.participant.username} does not accept proxy control`));
    }
    return raceAbort(reply, signal, timeout).finally(() => this.#pending.delete(id));
  }

  async #resolveBotProvider(token: unknown): Promise<void> {
    if (this.resolveBot && typeof token !== 'string') return;
    try {
      const provider: ProxyStateProvider | undefined = this.resolveBot
        ? await this.resolveBot(this.#botId!, token as string)
        : getBotStateProvider(this.#botId);
      if (!provider || !this.participant.connected) return;
      this.participant.provider = provider;
      this.participant.kind = 'bot';
      this.emit('provider');
    } catch (error) {
      global.log?.(`[proxy] bot provider resolution failed: ${error}`, 'warning');
    }
  }

  #write(message: Record<string, unknown>): boolean {
    this.participant.send('custom_payload', {
      channel: CONTROL_CHANNEL,
      data: Buffer.from(JSON.stringify(message)),
    });
    return this.participant.connected;
  }
}
