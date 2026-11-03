/**
 * Core plugin — minimal built-in commands. Kept tiny on purpose; it also serves
 * as the simplest example of how to add a plugin (subclass Plugin, declare
 * meta.commands, register pipeline handlers in start()).
 */
import { Plugin } from './Plugin';
import type { Participant } from '../Participant';
import type { Session } from '../Session';

export class CorePlugin extends Plugin {
  constructor(connection: Session) {
    super(connection, {
      name: 'core',
      description: 'JNbot proxy core',
      commands: [
        {
          name: 'status',
          description: 'Show connection info',
          handler: (_, sender) => this.#status(sender),
        },
        {
          name: 'sessions',
          description: 'List the sessions you can join',
          handler: (_, sender) => this.#sessions(sender),
        },
        {
          name: 'join',
          description: 'Move into the session of another account',
          args: ['account'],
          handler: ([account], sender) => this.#join(sender, account),
        },
      ],
    });
  }

  #status(sender: Participant): void {
    const { config, account, driver, version, phase } = this.connection;
    sender.tell(`§6§lJNbot Proxy§r §7| §f${account}`);
    sender.tell(`§7Upstream: §f${config.host}:${config.port}`);
    sender.tell(`§7Version: §f${version}`);
    sender.tell(`§7Phase: §f${phase} §7| Driver: §f${driver?.username ?? 'none'} §7| You: §f${sender.role}`);
  }

  #sessions(sender: Participant): void {
    sender.tell('§6§lJNbot Proxy §r§7— sessions:');
    for (const session of this.connection.server.sessions.values()) {
      const here = session === this.connection ? ' §a(here)' : '';
      const driver = session.driver ? `§7driven by §f${session.driver.username}` : '§7nobody drives';
      sender.tell(`§e${session.account} §7(${session.version}) ${driver}${here}`);
    }
  }

  #join(sender: Participant, account?: string): void {
    if (!account) return sender.tell('§cUsage: /jnbot join <account>');
    const session = [...this.connection.server.sessions.values()].find(
      (s) => s.account.toLowerCase() === account.toLowerCase(),
    );
    if (!session) return sender.tell(`§cNo session for §f${account}§c. See §6/jnbot sessions`);
    sender.tell(`§7Joining §f${session.account}§7…`);
    void this.connection.server.move(sender, session).then((result) => {
      if (!result.ok && sender.connected) sender.tell(`§c${result.message}`);
    });
  }
}
