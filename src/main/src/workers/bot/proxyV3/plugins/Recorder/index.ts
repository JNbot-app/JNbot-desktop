import { Plugin } from '../Plugin';
import type { Session } from '../../Session';
import { DebugCapture, RECORDINGS_PATH } from './Recorder';

export { RECORDINGS_PATH };

const DEBUG_MAX_PACKET_BYTES = 8 * 1024;

/** Bounded, inspection-only packet capture. Debug files are never executable. */
export class DebugPlugin extends Plugin {
  /** Called whenever a capture file is created or finalized. */
  static onCapturesChanged?: () => void;

  #capture: DebugCapture | null = null;

  constructor(connection: Session) {
    super(connection, {
      name: 'debug',
      description: 'Inspect proxy packets',
      commands: [
        {
          name: 'debug',
          description: 'Toggle packet debugging',
          handler: () => (this.#capture ? this.stopDebug() : this.startDebug()),
        },
      ],
    });
  }

  get active(): boolean {
    return this.#capture !== null;
  }

  get fileId(): string | undefined {
    return this.#capture?.id;
  }

  startDebug(options: { fileName?: string; full?: boolean } = {}): void {
    if (this.#capture) return;
    this.#capture = new DebugCapture({
      pipeline: this.pipeline,
      mcVersion: this.connection.version,
      fileName: options.fileName,
      ignorePackets: [],
      maxPacketBytes: options.full ? 0 : DEBUG_MAX_PACKET_BYTES,
      maxDiskBytes: this.connection.limits.debugDiskBytes,
      onLimit: () => {
        this.#capture = null;
        DebugPlugin.onCapturesChanged?.();
        this.tell(
          '§ePacket debugging stopped because its storage limit was reached.',
        );
      },
      onFailure: () => {
        this.#capture = null;
        DebugPlugin.onCapturesChanged?.();
        this.tell(
          '§cPacket debugging stopped because the debug file could not be written.',
        );
      },
    });
    this.#capture.record();
    DebugPlugin.onCapturesChanged?.();
    this.tell('§aPacket debugging enabled.');
  }

  stopDebug(): void {
    if (!this.#capture) return;
    const capture = this.#capture;
    this.#capture = null;
    capture.stop();
    DebugPlugin.onCapturesChanged?.();
    this.tell(
      `§aPacket debugging stopped. §7${capture.packetCount} packets → ${capture.id}`,
    );
  }

  stop(): void {
    this.stopDebug();
  }
}
