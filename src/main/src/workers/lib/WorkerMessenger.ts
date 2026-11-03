import { parentPort } from 'worker_threads';
import {
  Address,
  EndpointTransport,
  Messenger,
  TransportFrame,
} from '../../../../common/messaging';

class WorkerThreadTransport implements EndpointTransport {
  private readonly receivers = new Set<(frame: TransportFrame) => void>();

  constructor() {
    parentPort?.on('message', (message: unknown) => {
      if (
        !message ||
        typeof message !== 'object' ||
        !(message as { __messenger?: boolean }).__messenger
      )
        return;
      const frame = (message as { frame: TransportFrame }).frame;
      for (const receiver of this.receivers) receiver(frame);
    });
  }

  send(frame: TransportFrame): void {
    parentPort?.postMessage({ __messenger: true, frame });
  }

  async sendAsync(frame: TransportFrame): Promise<void> {
    this.send(frame);
  }

  subscribe(receiver: (frame: TransportFrame) => void): () => void {
    this.receivers.add(receiver);
    return () => this.receivers.delete(receiver);
  }
}

const workerThreadTransport = new WorkerThreadTransport();

export class WorkerMessenger extends Messenger {
  constructor(
    address: Address,
    public readonly profileId: number,
    public readonly scriptId: number,
  ) {
    super(address, workerThreadTransport);
  }
}
