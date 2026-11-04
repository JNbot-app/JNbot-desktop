const { once } = require('events');
const Statemachine = require('./Statemachine');

// [immidiate join command, server selector command, server selector slot, minimum mc version]
function getCommand(gamemode) {
  if (global.appSettings.server === 'pikanetwork') {
    switch (gamemode.toLowerCase().replace(/[^a-z]/g, '')) {
      case 'opfactions':
        return ['/server opfactions', '/server', 10, '*'];
      case 'opskyblock':
        return ['/server ', '/server', 12, '*'];
        case 'factions':
          return ['/server factions', '/server', 10, '*'];
      case 'classicskyblock':
      case 'skyblock':
        return ['/server classicskyblock', '/server', 12, '1.16.0'];
      case 'opprison':
        return ['/server opprison', '/server', 14, '*'];
      case 'kitpvp':
      case 'kit-pvp':
        return ['/server kit-pvp', '/server', 21, '*'];
      case 'practicepvp':
        return ['/server practice', '/server', 19, '*'];
      case 'survival':
        return ['/server survival', '/server', 23, '1.14.0'];
      case 'skywars':
        return ['/server skywars', '/server', 28, '*'];
      case 'bedwars':
        return ['/server bedwars', '/server', 30, '*'];
      case 'lifesteal':
        return ['/server lifesteal', '/server', 32, '1.16.0'];
      case 'skypvp':
        return ['/server skypvp', '/server', 37, '*'];
      case "skymines":
        return ["/server skymines", "/server", 39, "1.18.0"]
      default:
        log('[Error] Unknown gamemode: ' + gamemode.toLowerCase());
        return [
          '/server ' + gamemode.toLowerCase().replace(/[^ ]/g, ''),
          '/server',
          0,
          '*',
        ];
    }
  } else {
    switch (gamemode.toLowerCase().replace(/[^a-z]/g, '')) {
      case 'sbd':
      case 'skyblockdream':
        return ['/server skyblockdream', '/skyblock', 15, '*'];
      case 'sbf':
      case 'skyblockfantasy':
        return ['/server skyblockfantasy', '/skyblock', 11, '1.17.1'];
      case 'factions':
      case 'factionsimmortal':
        return ['/server factionsImmortal', '/server', 10, '*'];
      case 'prison':
        return ['/server prison', '/server', 14, '*'];
      case 'survival':
      case 'ꜱᴜʀᴠɪᴠᴀʟ':
      case 'spawnworld':
        return ['/server survival', '/server', 19, '1.19.2'];
      case 'thebridge':
        return [null, '/server', 23, '*'];
      case 'kitpvp':
        return ['/server kitpvp', '/server', 21, '*'];
      case 'bedwars':
        return ['/server bedwars', '/server', 32, '*'];

      case 'lifesteal':
        return ['/server lifesteal', '/server', 39, '1.19.3'];
      case 'ɢᴇɴꜱ':
      case 'gens':
        return ['/server gens', '/server', 39, '1.18.2'];
      default:
        log('[Error] Unknown gamemode: ' + gamemode.toLowerCase());
        return [
          '/server ' + gamemode.toLowerCase().replace(/[^ ]/g, ''),
          '/server',
          0,
          '*',
        ];
    }
  }
}

const cmds = [
  '/factions',
  '/prison',
  '/kitpvp',
  '/bedwars',
  '/server',
];

function randomizeCmd(cmd) {
  if (cmd !== '/server' || global.appSettings.server === 'pikanetwork')
    return cmd;
  return cmds[Math.floor(Math.random() * cmds.length)];
}

const joinGamemodeBehaviour = () => {
  const state = new Statemachine([
    {
      name: 'Version check & setup listeners',
      shouldTrigger: () => true,
      action: async (bot, targets) => {
        // Setup listeners (before version check so we're sure bot is still online)
        targets.events.__onMessagestr_timeout = null;
        targets.events.in_queue = false;
        if (targets.events.__onResourcePack)
          bot.removeListener('resourcePack', targets.events.__onResourcePack);
        if (targets.events.__onMessagestr)
          bot.removeListener('messagestr', targets.events.__onMessagestr);
        if (targets.events.__onForceMove) {
          bot.removeListener('forcedMove', targets.events.__onForceMove);
        }
        targets.events.__onResourcePack = () => bot.acceptResourcePack();
        targets.events.__onMessagestr = (m) => {
          m = m.toString().trim();

          if (m) {
            if (
              m ===
              '(!) Cannot join this server because you have a resource pack download pending.'
            ) {
              bot.acceptResourcePack();
            } else if (m.startsWith('► You are in position')) {
              const res = /([0-9]+) of ([0-9]+)/.exec(m);

              if (res && res[1] !== res[2]) {
                global.log(
                  `[State] ${bot.username} is in queue (${res[1]}/${res[2]})`,
                );
              }
              targets.events.in_queue = true;
              clearTimeout(targets.events.__onMessagestr_timeout);
              targets.events.__onMessagestr_timeout = setTimeout(() => {
                targets.events.in_queue = false;
              }, 15000);
            } else if (targets.usedCmd && m.endsWith('Unknown command.')) {
              global.log(
                '[State] ' +
                  bot.username +
                  " '/server' is an unknown command, trying other lobby...",
                'info',
              );
              bot.chat('/lobby');
            }
          }
        };

        targets.events.__onForceMove = () => {
          targets.events.in_queue = false;
        };

        bot.on('resourcePack', targets.events.__onResourcePack);
        bot.on('messagestr', targets.events.__onMessagestr);
        bot.on('forcedMove', targets.events.__onForceMove);
        if (targets.joinOptions.gamemode === 'ɢᴇɴꜱ')
          targets.joinOptions.gamemode = 'gens';
        // Check minecraft version
        const gm = targets.joinOptions.gamemode
          .toLowerCase()
          .replace(/[^a-z]/g, '');
        const commands = getCommand(gm);
        if (commands[3] === '*') return false;
        const version = parseInt(bot.version.split('.')[1]);
        if (!commands[3]) throw new Error('No minimum version for ' + gm);
        const minVersion = parseInt(commands[3].split('.')[1]);

        if (version < minVersion) {
          const msg = `${bot.username} is on version ${bot.version} but ${
            targets.joinOptions.gamemode
          } requires ${getCommand(targets.joinOptions.gamemode)?.[3]}`;
          log(`[State] ${msg}`, 'warning');


          const response = await global.client.showSnackbarWithButtons({
              body: `Version mismatch`,
              title: msg,
              buttons: [{label: 'Try anyways', id: 'try_anyways'}, {label: 'Stop script', id: 'stop_script'}],
          })

          if (!response || response === 'stop_script')
            process.exit(0);
        }
      },
      once: true,
    },
    {
      name: 'Opening selector',
      shouldTrigger: (bot, targets) =>
        !bot.currentWindow && !targets.events.in_queue,
      action: async (bot, targets) => {
        const gm = targets.joinOptions.gamemode
          .toLowerCase()
          .replace(/[^a-z]/g, '');
        const commands = getCommand(gm);

        let coords = null;
        if (!bot._client.chat) {
          log(`[State] ${bot.username} is not online`, 'warning');
          return;
        }
        if (commands[0]) {
          console.log(`[${bot.username}]: writing '${commands[0]}'`);
          bot.chat(commands[0]);
          targets.usedCmd = true;
          // If player was forced move then `coords` will be an array of coordinates
          coords = await Promise.race([
            once(bot, 'forcedMove'),
            bot.waitForTicks(50),
            sleep(4000),
          ]);
          if (!bot?.isOnline()) return;
          bot.removeAllListeners('forcedMove');
        }
        if (!coords) {
          if (!bot._client.chat) {
            log(`[State] ${bot.username} is not online`, 'warning');
            return;
          }
          const cmd = randomizeCmd(commands[1]);
          console.log(`[${bot.username}]: writing '${cmd}'`);
          bot.chat(cmd);
          targets.usedCmd = true;
          await bot.waitForTicks(10);
        }
      },
    },
    {
      name: 'Waiting for queue to end',
      shouldTrigger: (bot, targets) => targets.events.in_queue,
      action: () => {},
    },
    {
      name: 'Closing current window',
      shouldTrigger: (bot) =>
        !bot.getWindowTitle().toLowerCase().includes('server selector'),
      action: async (bot) => {
        bot.closeWindow(bot.currentWindow);
        await bot.waitForTicks(5);
      },
    },
    {
      name: 'Clicking on gamemode slot in selector',
      shouldTrigger: () => true,
      action: async (bot, targets) => {
        const gamemode = targets.joinOptions.gamemode
          .toLowerCase()
          .replace(/[^a-z]/g, '');
        let gmSlot = null;
        // Find the slot of the gamemode
        for (let i = 0; i < bot.currentWindow.inventoryStart; i++) {
          let slot = bot.currentWindow.slots[i];
          if (slot === null) continue;
          const name = bot
            .itemInfo(slot)
            .name?.toLowerCase()
            .replace(/(§.|[^a-z])/g, '');
          if (!name) continue;

          if (name.includes(gamemode)) {
            gmSlot = slot.slot;
            break;
          }
        }

        if (gmSlot === null) {
          log(
            `[Error] Could not find slot for gamemode ${gamemode} in selector, going to default slot`,
          );
          await bot.waitForTicks(5);
          if (!bot.isOnline()) return;
          gmSlot = getCommand(gamemode)[2];
          if (gmSlot === null)
            throw new Error(
              `[Error] Could not find slot for gamemode ${gamemode} in selector`,
            );
          bot.clickWindow(gmSlot, 0, 0);
          if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
        } else bot.clickWindow(gmSlot, 0, 0);
        await bot.waitForTicks(5);
      },
    },
  ]);
  state.onFinish((bot, targets) => {
    bot?.removeListener('resourcePack', targets.events.__onResourcePack);
    bot?.removeListener('messagestr', targets.events.__onMessagestr);
    bot?.removeListener('forcedMove', targets.events.__onForceMove);
    clearTimeout(targets.events.__onMessagestr_timeout);
    targets.events.in_queue = false
    targets.events.__onResourcePack = null;
    targets.events.__onMessagestr = null;
    targets.events.__onForceMove = null;
  });

  return state;
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(()=>resolve(true), ms));
}

module.exports = joinGamemodeBehaviour;
