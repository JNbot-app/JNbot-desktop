import { Plugin } from '../Plugin';
import type { Session } from '../../Session';
import { DebugCapture, RECORDINGS_PATH } from './Recorder';

export { RECORDINGS_PATH };

const DEBUG_MAX_PACKET_BYTES = 8 * 1024;

/** Bounded, inspection-only packet capture. Debug files are never executable. */
export class DebugPlugin extends Plugin {
  /** Called whenever a capture file is created or finalized. */
  static onCapturesChanged?: () => void;
  /** Record every new session in full from its login (movement replay tests). */
  static recordFromJoin = false;

  #capture: DebugCapture | null = null;
  /** The capture started at login with full chunks, so it can be replayed. */
  #fromJoin = false;
  #task: { name: string; start: number } | null = null;

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
        {
          name: 'task',
          description: 'Mark a task in the recording for the replay tests',
          args: ['name | end | cancel'],
          handler: (args) => this.#markTask(args),
        },
      ],
    });
  }

  start(): void {
    // Before the client is in play, so no chat feedback.
    if (!DebugPlugin.recordFromJoin) return;
    this.startDebug({ full: true, quiet: true });
    this.#fromJoin = true;
  }

  /** `/jnbot task <name>` starts a task, `end` finishes it and `cancel` discards it. */
  #markTask(args: string[]): void {
    if (!this.#capture || !this.#fromJoin)
      return this.tell('§cThis session is not recorded from join. Enable §f"Record sessions from join"§c in the proxy settings and rejoin.');
    const [word = ''] = args;
    if (word === 'end' || word === 'cancel') {
      if (!this.#task) return this.tell('§cNo task is running. Start one with §6/jnbot task <name>');
      const { name, start } = this.#task;
      this.#task = null;
      this.#capture.mark('jnbot:task', { action: word, name });
      return this.tell(word === 'end'
        ? `§aTask §f${name}§a recorded §7(${((Date.now() - start) / 1000).toFixed(1)}s)`
        : `§eTask §f${name}§e cancelled.`);
    }
    const name = args.join('_').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!name) return this.tell('§cUsage: /jnbot task <name> §7then §6/jnbot task end§7 (or §6cancel§7)');
    if (this.#task) this.#capture.mark('jnbot:task', { action: 'end', name: this.#task.name });
    this.#task = { name, start: Date.now() };
    this.#capture.mark('jnbot:task', { action: 'start', name });
    this.tell(`§aTask §f${name}§a started. §7Do it, then §6/jnbot task end`);
  }

  get active(): boolean {
    return this.#capture !== null;
  }

  get fileId(): string | undefined {
    return this.#capture?.id;
  }

  startDebug(options: { fileName?: string; full?: boolean; quiet?: boolean } = {}): void {
    if (this.#capture) return;
    this.#fromJoin = false;
    this.#task = null;
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
    if (!options.quiet) this.tell('§aPacket debugging enabled.');
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
