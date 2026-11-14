const BotStatemachine = require('../../bot/statemachines/BotStatemachine');
const workerScript = require('../../lib/workerScript').default;

function inventoryCleaner(_, __, defaultBot) {
  return new Promise((resolve) => {
    let disposeNext = () => {};
    let disposeRelog = () => {};
    let disposePrev = () => {};
    const botStatemachine = new BotStatemachine(
      defaultBot,
      [
        {
          name: 'Disabling the menu in inventory setting',
          shouldTrigger: (bot) =>
            bot.currentWindow && bot.getWindowTitle().includes('Settings'),
          action: async (bot, targets) => {
            const slot = bot.currentWindow.slots.find(
              (slot) =>
                slot &&
                bot
                  .itemInfo(slot)
                  .name.toLowerCase()
                  .includes('menu in inventory'),
            );
            if (!slot) {
              log(
                "Failed to find the 'menu in inventory' setting in /settings. To fix this, update `MENU_SETTING_NAME` option.",
              );
              return;
            }
            const nbtData = bot.itemInfo(slot);

            if (nbtData.info.includes('Current state: §c✖')) {
              console.log('Menu setting is already disabled');
              return;
            }
            bot.clickWindow(slot.slot, 0, 0);
            targets.has_disabled_clock = true;
            await bot.waitForTicks(5);
            if (bot?.currentWindow) {
              bot.closeWindow(bot.currentWindow);
              await bot.waitForTicks(10);
            }
          },
        },
        {
          name: 'Closing incorrect window',
          shouldTrigger: (bot) => !!bot.currentWindow,
          action: async (bot) => {
            console.log('Window opened: ' + bot.getWindowTitle());
            bot.closeWindow(bot.currentWindow);
          },
        },
        //  {
        //    name: 'Opening /settings window',
        //    shouldTrigger: (bot) =>
        //      REMOVE_CLOCK &&
        //      bot.inventory.slots.find((item) => item && item.name === 'clock'),
        //    action: async (bot) => {
        //      console.log('Sending /settings');
        //      bot.chat('/settings');
        //      await bot.waitForTicks(10);
        //    },
        //  },
        {
          name: 'Clearing inventory',
          shouldTrigger: (bot) =>
            bot.inventory.slots
              .slice(bot.inventory.inventoryStart)
              .some((item) => item && item.name !== 'clock'),
          action: async (bot) => {
            bot.chat('/ci confirm');
            await bot.waitForTicks(5);
            await bot.transfer('trash', { exclude: { type: 'clock' } });
            await bot.waitForTicks(10);
            if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
          },
        },
        {
          name: 'Finished clearing inventory',
          shouldTrigger: () => true,
          action: (bot) => {
            // We wait 1 tick to make sure stateMachine is initialized
            process.nextTick(() => {
              botStatemachine.stop();
              if (!defaultBot) bot.end();
              resolve();
            });
          },
        },
      ],
      {},
    ).start();

    function handleNextBot() {
      resolve(1);
      botStatemachine.stop();
    }

    function handleRelogBot() {
      resolve(2);
      botStatemachine.stop();
    }

    function handlePrevBot() {
      resolve(3);
      botStatemachine.stop();
    }

    botStatemachine.onFinish((bot) => {
      if (!defaultBot && bot) {
        bot?.end?.();
      }
      disposeNext();
      disposePrev();
      disposeRelog();
      resolve(0);
    });

    disposeNext = workerScript.onMessage('NEXT_BOT', handleNextBot);
    disposeRelog = workerScript.onMessage('RELOG_BOT', handleRelogBot);
    disposePrev = workerScript.onMessage('PREV_BOT', handlePrevBot);
  });
}

module.exports = inventoryCleaner;
