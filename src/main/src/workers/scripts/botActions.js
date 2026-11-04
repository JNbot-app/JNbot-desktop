/**********************************************

Bot Made by usserwout

***********************************************/

const join = require('../bot/join');
const { once } = require('events');
const BotStatemachine = require('../bot/statemachines/BotStatemachine');
const { getOrAskPassword } = require('../lib/MissingDataHandler');
const { workerData } = require('worker_threads');

async function main(args) {
  const botAction = new BotActions(args);
  botAction.start();
}

class BotActions {
  scriptSettings = {};

  #functions = {
    'alt-maker': () => this.altMaker(),
    'password-changer': () => this.passwordChanger(),
  };

  constructor(args) {
    this.scriptSettings = args;
  }

  start() {
    if (typeof this.#functions[this.scriptSettings.script] === 'function') {
      this.#functions[this.scriptSettings.script]();
    } else {
      console.log(
        'Script name: ' + this.scriptSettings.script + ' is not found',
      );
    }
  }

  async altMaker() {
    let reponseMessage = '';
    let bot = await join({ username: this.scriptSettings.username });
    if (!bot) return;
    await once(bot, 'spawn');
    if (!this.scriptSettings.password) {
      console.log('Password is undefined');
      return process.nextTick(() => process.exit(0));
    }
    await bot.waitForTicks(40);
    const sendRegisterMsg = setInterval(() => {
      bot.chat(
        `/register ${this.scriptSettings.password}  ${this.scriptSettings.password}`,
      );
    }, 2000);
    /**
     *
     * Response:
     * 1: Success
     * 2: Already registered
     * 3: You have exceeded the maximum number of registrations for your connection
     * 4: Your password is too short or too long! Please try with another one!
     * 5: Failed to create alt
     */

    const wait4msg = () => {
      return new Promise((resolve) => {
        bot.on('message', (msg) => {
          msg = msg.toString();
          if (
            msg.includes('Unknown command.') ||
            msg.includes('You already have registered this username!')
          ) {
            reponseMessage = `${bot.username} is already registered`;
            resolve(2);
            //  this.send(reponseMessage);
          } else if (
            msg.includes(
              'You have exceeded the maximum number of registrations for your connection',
            )
          ) {
            reponseMessage =
              'You cannot register alts anymore under this IP-address';
            resolve(3);
            //   this.send(reponseMessage);
          } else if (
            msg.includes(
              'Your password is too short or too long! Please try with another one!',
            )
          ) {
            reponseMessage = 'Your password does not meet the requirements';
            resolve(4);
          } else if (msg.includes('Successfully registered!')) {
            reponseMessage = 'Successfully registered!';
            resolve(1);
          }
        });
      });
    };
    let response = await Promise.race([wait4msg(), this.sleep(10000)]);
    clearInterval(sendRegisterMsg);
    if (response === 1) {
      if (this.scriptSettings.email)
        bot.chat('/email ' + this.scriptSettings.email);

      workerData.settings.alts.push({
        username: this.scriptSettings.username,
        jartexnetwork: {
          gkits: {},
          ranks: {},
          password: this.scriptSettings.password,
        },
        pikanetwork: {
          gkits: {},
          ranks: {},
          password: this.scriptSettings.password,
        },
      });
      send('UPDATE_SETTINGS', { alts: workerData.settings.alts });
    }

    this.snackbar(
      response === 1 ? 'success' : 'error',
      reponseMessage || 'Failed to register',
    );
    setTimeout(() => {
      process.exit(0);
    }, 250);
  }

  async passwordChanger() {
    if (!this.scriptSettings.newPassword) {
      global.log('No new password provided', 'error');
      return setTimeout(() => {
        process.exit(0);
      }, 100);
    }

    for (const username of this.scriptSettings.alts) {
      await this.changePassword(username);
    }
    setTimeout(() => {
      process.exit(0);
    }, 100);
  }

  async changePassword(username) {
    const alt = workerData.settings.alts?.find((x) => x.username === username);
    const oldPassword = await getOrAskPassword(username);
    if (!oldPassword) {
      global.log(`No password found for ${username}`, 'error');
      return;
    }
    return new Promise((resolve) => {
      const statemachine = new BotStatemachine(
        null,
        [
          {
            name: 'Resetting password',
            shouldTrigger: () => true,
            action: async (bot) => {
              await bot.waitForTicks(20);

              bot.chat(
                `/cp ${oldPassword} ${this.scriptSettings.newPassword} ${this.scriptSettings.newPassword}`,
              );
              await bot.waitForTicks(5);
              alt.data ??= { gkits: {}, ranks: {} };
              alt.data.password = this.scriptSettings.newPassword;
              send('UPDATE_SETTINGS', { alts: workerData.settings.alts });
              this.snackbar('success', `Changed password for ${username}`);
              statemachine.stop();
            },
          },
        ],
        {
          targets: {
            alt: {
              username,
            },
            joinOptions: {
              login: true,
            },
          },
          extensions: {
            joinServer: true,
          },
        },
      ).start();

      statemachine.onFinish((bot) => {
        if (bot) bot.end();
        resolve();
      });
    });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  snackbar(type, message) {
    global.sendToClients('snackbar', {
      title: message,
      variant: type ?? '',
    });
  }
}

module.exports = main;
