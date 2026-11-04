const Statemachine = require('./Statemachine');
const {
  gamemodeTranslate,
  gamemodeTranslateReverse,
} = require('./joinGamemode/joinGamemodeBehaviourV2');
const joinGamemodeBehaviourV3 = require('./joinGamemode/joinGamemodeBehaviourV3').default;


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

      if (this.targets.joinOptions.gamemode in gamemodeTranslate) {
        this.targets.joinOptions.gamemode =
          gamemodeTranslate[this.targets.joinOptions.gamemode];
      }
    }
    if (this.options.extensions.joinGm) {
      // The V3 adapter runs the join to completion and tears down its own
      // listeners/timeouts (runJoinCleanup), so no companion "finish" behaviour
      // is needed here as there was for the old V2 Statemachine action.
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
      shouldTrigger: (bot, targets) => {
        // console.log(
        //   !bot
        //     ?.getGamemode()
        //     ?.toLowerCase()
        //     .replace(/[^a-z]/, '')
        //     .includes(
        //       gamemodeTranslate[targets.joinOptions?.gamemode] ||
        //         targets.joinOptions?.gamemode
        //     ),
        //   bot?.getGamemode()?.toLowerCase(),
        //   gamemodeTranslate[targets.joinOptions?.gamemode] ||
        //     targets.joinOptions?.gamemode
        // );

        // console.log(
        //   'Current gamemode: ',
        //   bot
        //     ?.getGamemode()
        //     ?.toLowerCase()
        //     .replace(/[^a-z]/, ''),
        //   ' Target gamemode: ',
        //   gamemodeTranslate[targets.joinOptions?.gamemode] ||
        //     targets.joinOptions?.gamemode,
        // );

        if (!targets.joinOptions?.gamemode) {
          return false;
        }

        if (targets.__join_data?.hasFinished) {
          // used for optimistic join
          return false;
        }

        
        let gmStr = bot
        ?.getGamemode()
        ?.toLowerCase()
        .replace(/[^a-z]/, '');
        if (gmStr in gamemodeTranslateReverse) {
          gmStr = gamemodeTranslateReverse[gmStr];
        }
        
        // console.log(gmStr, gamemodeTranslate[targets.joinOptions?.gamemode] ||
        //     targets.joinOptions?.gamemode, !gmStr?.includes?.(
        //   gamemodeTranslate[targets.joinOptions?.gamemode] ||
        //     targets.joinOptions?.gamemode
        // ))
        return !gmStr?.includes?.(
          gamemodeTranslate[targets.joinOptions?.gamemode] ||
            targets.joinOptions?.gamemode
        );
      },
      action: async (bot, targets) =>
        await joinGamemodeBehaviourV3(bot, targets.joinOptions.gamemode),
    };
  }
}

module.exports = BotStatemachine;
