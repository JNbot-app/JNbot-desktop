import { Address } from './Address';
import { MessageEnvelope } from './Protocol';

export interface TransportCapabilities {
  readonly structuredClone: boolean;
  readonly binary: boolean;
  readonly backpressure: boolean;
  readonly maxFrameBytes?: number;
  readonly codec: 'structured-clone' | 'json' | 'binary';
}

export interface TransportRoute {
  readonly id: string;
  readonly address?: Address;
}

export interface TransportFrame {
  readonly envelope: MessageEnvelope;
  readonly encodedPayload?: Uint8Array | string;
  readonly codec?: TransportCapabilities['codec'];
}

export type FrameReceiver = (
  route: TransportRoute,
  frame: TransportFrame,
) => void | Promise<void>;

export interface TransportAdapter {
  readonly capabilities: TransportCapabilities;
  start(onFrame: FrameReceiver): Promise<void>;
  send(route: TransportRoute, frame: TransportFrame): void;
  sendAsync(route: TransportRoute, frame: TransportFrame): Promise<void>;
  close(): Promise<void>;
}

export interface EndpointTransport {
  send(frame: TransportFrame): void;
  sendAsync(frame: TransportFrame): Promise<void>;
  subscribe(receiver: (frame: TransportFrame) => void): () => void;
  close?(): void | Promise<void>;
}
