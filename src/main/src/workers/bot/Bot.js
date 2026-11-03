const joinServer = require('./join');

/**
 * Bot — the entry point for creating a bot and joining a server.
 *
 * A `Bot` wraps a profile (the account/connection options: `username`, `host`,
 * `port`, …) so the same profile can be reused to join. Both `bot.join(...)`
 * and the static `Bot.join(...)` resolve with the connected bot.
 *
 * @example
 *   const { Bot } = require('JNbot');
 *   const bot = new Bot({ username: 'Zola' });
 *   await bot.join({ gamemode: 'skyblockdream', login: true });
 *
 * @example
 *   const { Bot } = require('JNbot');
 *   const bot = await Bot.join({ username: 'Zola' }, { gamemode: 'skyblockdream' });
 */
class Bot {
  constructor(profile = {}) {
    this.profile = profile;
  }

  /** Join the server with this bot's profile. Resolves with the connected bot. */
  join(options = {}) {
    return joinServer(this.profile, options);
  }

  /** Create a bot from a profile and join in one call. */
  static join(profile = {}, options = {}) {
    return joinServer(profile, options);
  }
}

module.exports = Bot;
