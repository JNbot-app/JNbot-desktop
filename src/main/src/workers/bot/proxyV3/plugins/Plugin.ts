/**
 * Minimal plugin base for the transparent proxy. A plugin observes/edits the
 * packet stream via `this.pipeline` and optionally exposes `/jnbot <command>`s.
 * No GUI machinery — feedback is plain chat via `this.tell`.
 */
import EventEmitter from 'node:events';
import type { Session } from '../Session';
import type { Participant } from '../Participant';
import type { PacketPipeline } from '../PacketPipeline';

export interface ICommand {
  /** the token typed after `/jnbot `, e.g. "record" */
  name: string;
  description: string;
  /** argument names, for usage/help only */
  args?: string[];
  hidden?: boolean;
  /** `sender`: the participant that typed the command. */
  handler(args: string[], sender: Participant): void;
}

export interface IPluginMeta {
  name: string;
  description: string;
  commands?: ICommand[];
  hidden?: boolean;
}

export abstract class Plugin extends EventEmitter {
  readonly connection: Session;
  readonly meta: Required<Pick<IPluginMeta, 'name' | 'description'>> &
    IPluginMeta;

  constructor(connection: Session, meta: IPluginMeta) {
    super();
    this.connection = connection;
    this.meta = { commands: [], hidden: false, ...meta };
  }

  get pipeline(): PacketPipeline {
    return this.connection.pipeline;
  }

  /** Send chat feedback to the player. */
  tell(message: string): void {
    this.connection.tell(message);
  }

  start(): void {}
  stop(): void {}
}
