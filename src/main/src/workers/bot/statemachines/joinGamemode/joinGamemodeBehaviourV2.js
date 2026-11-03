const Statemachine = require('../Statemachine');
const getCommand = require('./gamemodeData');
const { once } = require('events');

const gamemodeTranslate = {
  sbf: 'skyblockfantasy',
  sbd: 'skyblockdream',
  opfac: 'opfactions',
  practice: 'practicepvp',
  classicskyblock: 'skyblock',
};

// for checking selector
const gamemodeTranslateReverse = {
  spawnworld: 'survival',
  ꜱᴜʀᴠɪᴠᴀʟ: 'survival',
  opfac: 'opfactions',
  practice: 'practicepvp',
  classicskyblock: 'skyblock',

  // ꜱᴜʀᴠɪᴠᴀʟ: 'survival',
  // ɢᴇɴꜱ: 'gens',
};

function joinGamemodeBehaviourV2() {
  const statemachine = new Statemachine([
    {
      name: 'Setting up listeners',
      once: true,
      shouldTrigger: () => true,
      action: async (bot, targets) => {
        console.log('Start joining: ' + targets.joinOptions.gamemode);
        bot?.chat('/queue leave');
        targets.__click_counter = 0;
        targets.__join_events ??= {};
        targets.__join_timeouts ??= {};
        targets.__join_intervals ??= {};
        targets.__join_data ??= {};
        targets.__join_data.in_queue = false;
        targets.__join_data.cmdSend = false;
        targets.__join_data.hasFinished = false;
        targets.joinOptions.optimisticJoin ??=
          global.appSettings.optimistic_join_gamemode ?? false;

        targets.__join_stuck_counter = targets.join_stuck_counter || 0;
        targets.__join_events.resourcePack = () => {
          if (targets.joinOptions.gamemode === 'oneblock') {
            // Even though the bot gets prompted for a resource pack, we don't accept it.
            // If we accept /deny it we get kicked to the lobby for some reason.
          } else {
            bot.acceptResourcePack();
          }
        };
        targets.__join_events.move = () => {
          const prevPos = bot.entity.position.minus(bot.entity.velocity);
          const dist = prevPos.distanceTo(bot.entity.position);
          if (dist < 1) return; // sometimes the bot is stuck in a block triggering a bunch of move events.
          targets.__join_data.in_queue = false;
          if (targets.joinOptions.optimisticJoin) {
            targets.__join_data.hasFinished = true;
          }
        };
        targets.__join_events.forcedMove = targets.__join_events.move;

        targets.__join_events.messagestr = (msg) => {
          const m = msg.toString().trim();
          if (!m) return;
          if (
            m.endsWith(
              'Cannot join this server because you have a resource pack download pending.',
            )
          ) {
            bot.acceptResourcePack();
            console.log('Accepting resourcepack');
          } else if (
            m.startsWith('► ') &&
            m.includes('You are in position') &&
            targets.__join_data.cmdSend
          ) {
            const res = /([0-9]+) of ([0-9]+)/.exec(m);
            if (!res) return;
            global.log(
              `[State] ${bot.username} is in ${targets.joinOptions.gamemode} queue: ${res[1]}/${res[2]}`,
            );
            targets.__join_data.in_queue = true;
            clearTimeout(targets.__join_timeouts.queue);
            targets.__join_timeouts.queue = setTimeout(() => {
              targets.__join_data.in_queue = false;
            }, 20_000);
          } else if (
            m.includes(
              'Please reconnect to the server. If this does not resolve your issue, please contact staff',
            ) &&
            targets.__join_data.in_queue
          ) {
            targets.__join_data.in_queue = false;
            clearTimeout(targets.__join_timeouts.queue);
          }
        };

        bot.on('resourcePack', targets.__join_events.resourcePack);
        bot.on('messagestr', targets.__join_events.messagestr);
        bot.on('move', targets.__join_events.move);
        bot.on('forcedMove', targets.__join_events.forcedMove);

        if (targets.joinOptions.gamemode === 'ɢᴇɴꜱ')
          targets.joinOptions.gamemode = 'gens';
        // Check minecraft version
        const gm = targets.joinOptions.gamemode
          .toLowerCase()
          .replace(/[^a-z]/g, '');
        targets.__join_data.gamemode = gm;
        targets.__join_data.joinCommand = getCommand(gm);
        if (targets.__join_data.joinCommand[3] === '*') return false;
        const version = parseInt(bot.version.split('.')[1]);
        if (!targets.__join_data.joinCommand[3])
          throw new Error('No minimum version for ' + gm);
        const minVersion = parseInt(
          targets.__join_data.joinCommand[3].split('.')[1],
        );

        if (version < minVersion) {
          const msg = `${bot.username} is on version ${bot.version} but ${targets.joinOptions.gamemode} requires ${targets.__join_data.joinCommand?.[3]}`;
          global.log(`[State] ${msg}`, 'warning');



          const response = await global.client.showSnackbarWithButtons({
              body: `Version mismatch`,
              title: msg,
              buttons: [{label: 'Try anyways', id: 'try_anyways'}, {label: 'Stop script', id: 'stop_script'}],
          })
          if (!response || response === 'stop_script')
            process.exit(0);
        }
      },
    },
    {
      name: 'Waiting for queue to end',
      shouldTrigger: (bot, targets) =>
        targets.__join_data.in_queue && !targets.__join_data.hasFinished,
      action: (bot, targets) => {
        console.log(
          'Waiting for ' + targets.joinOptions.gamemode + ' queue to end...',
        );
        targets.__join_stuck_counter = 0;
      },
    },
    {
      name: 'Opening selector',
      shouldTrigger: (bot, targets) =>
        !bot.currentWindow && !targets.__join_data.hasFinished,
      action: async (bot, targets) => {
        targets.gmCount ??= 0;
        targets.__join_stuck_counter++;
        if (targets.__join_stuck_counter > 5) {
          // At this point the bot prob got disconnected,
          global.log(
            bot.username +
              ' most likely got bugged causing the server to gracefully disconnect the bot. Disconnecting...',
            'error',
          );
          await sleep(2000);
          bot.end();
          statemachine.stop(bot, targets);
          return;
        }
        targets.__join_data.joinCommand = getCommand(
          targets.joinOptions.gamemode.toLowerCase().replace(/[^a-z]/g, ''),
        );
        const cmd =
          targets.__join_data.joinCommand[targets.gmCount] ??
          targets.__join_data.joinCommand[0];
        targets.gmCount = (targets.gmCount + 1) % 2;

        if (!cmd) return;
        bot.chat(cmd);
        targets.__join_data.cmdSend = true;
        await Promise.race([
          once(bot, 'forcedMove'),
          once(bot, 'windowOpen'),
          bot.waitForTicks(50),
          sleep(4000),
        ]);
        if (!bot.isOnline()) {
          global.log(`[State] ${bot.username} socket is no longer connected.`);
          return;
        }
        if (
          !bot.currentWindow &&
          !targets.__join_data.in_queue &&
          targets.__join_data.noCmdFound
        ) {
          // Bot is inside bugged lobby
          bot.chat('/lobby');
          global.log(
            `[State] ${bot.username} failed to open server selector, trying different lobby (/lobby).`,
          );
        }
      },
    },
    {
      name: 'Closing current window',
      shouldTrigger: (bot, targets) =>
        !targets.__join_data.hasFinished &&
        !bot.getWindowTitle().toLowerCase().includes('server selector'),
      action: async (bot, targets) => {
        targets.__join_stuck_counter = 0;
        console.log('Window: ', bot.getWindowTitle());
        bot.closeWindow(bot.currentWindow);
        await bot.waitForTicks(5);
      },
    },
    {
      name: 'Clicking on gamemode',
      shouldTrigger: (bot, targets) =>
        !targets.__join_data.hasFinished && bot.currentWindow,
      action: async (bot, targets) => {
        let gmSlot = undefined;
        targets.__join_stuck_counter = 0;
        const targetGamemode =
          gamemodeTranslateReverse[targets.__join_data.gamemode] ??
          targets.__join_data.gamemode;

        for (let i = 0; i < bot.currentWindow.inventoryStart; i++) {
          let slot = bot.currentWindow.slots[i];
          if (slot === null) continue;
          const name = bot
            .itemInfo(slot)
            .name?.toLowerCase()
            .replace(/(§.|[^a-z])/g, '');
          if (!name) continue;
          if (name.includes(targetGamemode)) {
            gmSlot = slot.slot;
            break;
          }
        }

        if (!gmSlot) {
          global.log(
            `[Error] Could not find slot for gamemode ${targetGamemode} in selector, going to default slot`,
          );
          await bot.waitForTicks(10);
          if (!bot.isOnline()) return;
          gmSlot = targets.__join_data.joinCommand[2];
        }

        bot.clickWindow(gmSlot, 0, 0);
        await bot.waitForTicks(5);

        if (!bot.isOnline()) return;
        if (bot && bot.currentWindow && ++targets.__click_counter > 3) {
          bot.closeWindow(bot.currentWindow);
          global.log(
            `[State] ${bot.username} failed to click on gamemode, trying...`,
          );
          targets.__click_counter = 0;
          await bot.waitForTicks(2);
        }

        if (targets.joinOptions.optimisticJoin) {
          targets.__join_data.hasFinished = true;
          await sleep(1000);
        }
      },
    },
  ]);

  statemachine.onFinish((bot, targets) => {
    targets.__join_data ??= {};
    targets.__join_data.in_queue = false;
    targets.__join_data.cmdSend = false;
    targets.__click_counter = 0;
    targets.__join_stuck_counter = 0;

    // Remove events
    for (let e in targets.__join_events ?? {}) {
      if (targets.__join_events[e]) {
        bot?.removeListener(e, targets.__join_events[e]);
      }
    }
    targets.__join_events = null;

    // Remove intervals
    for (let i in targets.__join_intervals ?? {}) {
      if (targets.__join_intervals[i])
        clearInterval(targets.__join_intervals[i]);
    }

    // Remove timeouts
    for (let t in targets.__join_timeouts ?? {}) {
      if (targets.__join_timeouts[t]) clearTimeout(targets.__join_timeouts[t]);
    }
  });

  return statemachine.activate();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(true), ms));
}
module.exports = {
  joinGamemodeBehaviourV2,
  gamemodeTranslate,
  gamemodeTranslateReverse,
};
