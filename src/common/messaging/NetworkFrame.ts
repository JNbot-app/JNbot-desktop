import { MessageEnvelope, validateEnvelope } from './Protocol';
import { EndpointTransport, TransportFrame } from './Transport';

const SEPARATOR = '\n';

type HeaderEnvelope = Omit<MessageEnvelope, 'data'>;

export function encodeNetworkFrame(frame: TransportFrame): string {
  const { data, ...header } = frame.envelope;
  const encodedPayload =
    frame.codec === 'json' && typeof frame.encodedPayload === 'string'
      ? frame.encodedPayload
      : data === undefined
        ? 'null'
        : JSON.stringify(data);
  return `${JSON.stringify(header)}${SEPARATOR}${encodedPayload}`;
}

export function decodeNetworkFrame(
  raw: string,
  maxFrameBytes = 8 * 1024 * 1024,
): TransportFrame {
  if (typeof raw !== 'string')
    throw new TypeError('Network frame must be a string');
  if (new TextEncoder().encode(raw).byteLength > maxFrameBytes)
    throw new RangeError('Network frame is too large');
  const separator = raw.indexOf(SEPARATOR);
  if (separator <= 0) throw new TypeError('Malformed network frame');
  const header = JSON.parse(raw.slice(0, separator)) as HeaderEnvelope;
  const envelope = { ...header, data: undefined } as MessageEnvelope;
  validateEnvelope(envelope);
  return {
    envelope,
    encodedPayload: raw.slice(separator + 1),
    codec: 'json',
  };
}

export function materializeFrame(frame: TransportFrame): TransportFrame {
  if (frame.codec !== 'json' || typeof frame.encodedPayload !== 'string')
    return frame;
  return {
    ...frame,
    envelope: {
      ...frame.envelope,
      data: JSON.parse(frame.encodedPayload),
    },
  };
}

export interface NetworkSocket {
  send(data: string): void;
  onMessage(handler: (data: string) => void): () => void;
  close?(): void | Promise<void>;
}

export class NetworkEndpointTransport implements EndpointTransport {
  private readonly receivers = new Set<(frame: TransportFrame) => void>();
  private readonly detach: () => void;

  constructor(
    private readonly socket: NetworkSocket,
    maxFrameBytes?: number,
  ) {
    this.detach = socket.onMessage((raw) => {
      const frame = decodeNetworkFrame(raw, maxFrameBytes);
      for (const receiver of this.receivers) receiver(frame);
    });
  }

  send(frame: TransportFrame): void {
    this.socket.send(encodeNetworkFrame(frame));
  }

  async sendAsync(frame: TransportFrame): Promise<void> {
    this.send(frame);
  }

  subscribe(receiver: (frame: TransportFrame) => void): () => void {
    this.receivers.add(receiver);
    return () => this.receivers.delete(receiver);
  }

  async close(): Promise<void> {
    this.detach();
    this.receivers.clear();
    await this.socket.close?.();
  }
}
