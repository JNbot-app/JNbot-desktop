const Statemachine = require('./Statemachine');
const joinGamemode = require('./joinGamemode/joinGamemodeBehaviourV3').default;
const { gamemodeMatches } = require('../gamemode');

const {
  getKickAction,
  resolveKickAction,
} = require('../controls/kickControl');

class BotStatemachine extends Statemachine {
  bot = null;

  constructor(bot, behaviours, options = {}) {
    super(behaviours, options);

    this.bot = bot;
    this.options.extensions = Object.assign(
      { joinServer: false, joinGm: false },
      this.options.extensions || {},
    );
    if (options.extensions?.joinServer === undefined)
      this.options.extensions.joinServer = !!this.targets.alt;

    if (this.targets.joinOptions && this.targets.joinOptions.gamemode) {
      this.options.extensions.joinGm =
        options.targets?.extensions?.joinGm ??
        options?.extensions?.joinGm ??
        !bot;
      this.targets.joinOptions.gamemode = this.targets.joinOptions.gamemode
        .toLowerCase()
        .replace(/[^a-z]/g, '');
    }
    if (this.options.extensions.joinGm) {
      // joinGamemode runs to completion and cleans up after itself.
      this.behaviours.unshift(this.__joinGamemodeAction);
    }
    if (this.options.extensions.joinServer)
      this.behaviours.unshift(this.__joinServerAction);

    this.resetOnceOnEnd = this.options.resetOnceOnEnd;
  }

  pause(botId = this.bot?.botId) {
    if (this.paused) return;
    super.pause();
    if (botId) {
      global.send('BOT_STATUS_UPDATE', {
        botId: botId,
        status: 'paused',
      });
    }
  }

  resume(botId = this.bot?.botId) {
    if (!this.paused) return;
    super.resume();
    if (botId) {
      global.send('BOT_STATUS_UPDATE', {
        botId: botId,
        status: 'resumed',
      });
    }
  }

  get __joinServerAction() {
    return {
      name: 'Join Server',
      shouldTrigger: (bot) => !bot || !bot.isOnline(),
      action: async (_, targets) => {
        this.resetOnce();
        if (targets.alt) {
          this.bot = await require('../join')(
            { ...targets.alt },
            {
              joinGamemode: false,
              login: true,
              retryOnLoginFail: false, // We set this to false to allow the user to skip the alt if needed.
              ...targets.joinOptions,
              onKick: (reason, botInfo) => {
                const action = getKickAction(reason);
                if (action === 'pause') this.pause(botInfo.botId);
                void resolveKickAction(botInfo, reason, action).then(
                  (decision) => {
                    if (decision === 'retry') this.resume(botInfo.botId);
                    else this.finish();
                  },
                );
              },
            },
          );

          if (this.bot) global.log(`[${targets.alt.username}] joined server`);
        } else global.log('No alt provided (targets.alt)', 'error');
      },
    };
  }

  get __joinGamemodeAction() {
    return {
      name: 'Join Gamemode',
      shouldTrigger: (bot, targets) =>
        !!targets.joinOptions?.gamemode &&
        !gamemodeMatches(bot?.getGamemode(), targets.joinOptions.gamemode),
      action: async (bot, targets) =>
        await joinGamemode(bot, targets.joinOptions.gamemode),
    };
  }
}

module.exports = BotStatemachine;
