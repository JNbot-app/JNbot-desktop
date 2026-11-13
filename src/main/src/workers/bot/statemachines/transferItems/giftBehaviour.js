const { hasTradeableItem } = require('./transferUtil');

const giftBehaviour = [
  {
    name: 'Opening gift window',
    when: ({bot}) => !bot.currentWindow,
    run: async ({bot, state, machine}) => {
      if (!hasTradeableItem(bot, state)) {
        machine.finish();
      } else {
        await bot.openWindow('/gift ' + state.username, {timeout: 10_000});

        if (!bot.currentWindow) {
          log('[' + bot.username + '] Failed to open gift window', 'error');
          machine.finish();
        }
      }
    },
  },

  {
    name: 'Accepting gift',
    when: ({bot}) =>
      bot.getWindowTitle().includes(bot.transferItems.config.giftConfirmWindowTitle),
    run: ({bot}) => {
      let slot_index = null;
      for (let i = 0; i < bot.currentWindow.inventoryStart; i++) {
        const slot = bot.currentWindow.slots[i];
        
        if (
          slot &&
          (slot.metadata === 13 || slot?.name === 'green_terracotta' || bot.itemInfo(slot).name.toLowerCase().includes("confirm"))
        ) {
          slot_index = i;
          break;
        }
      }
      if (slot_index === null) {
        global.log('Could not find accept button in gift window: ' + bot.getWindowTitle(), 'warning');
        bot.clickWindow(11, 0, 0);
      } else {
        bot.clickWindow(slot_index, 0, 0);
      }
    },
  },
  {
    name: 'Finished depositing item',
    when: ({bot, state}) =>
      bot.getWindowTitle().includes(bot.transferItems.config.giftDepositWindowTitle) &&
      (!hasTradeableItem(bot, state) ||
        bot.currentWindow.slots.slice(0, bot.currentWindow.inventoryStart).every((slot) => slot === null)),
    run: async ({bot}) => {
      bot.closeWindow(bot.currentWindow);

      await bot.onceWithTimeout('windowOpen', 20);
    },
  },
  {
    name: 'Depositing items',
    when: ({bot}) =>
      bot.getWindowTitle().includes(bot.transferItems.config.giftDepositWindowTitle),
    run: async ({bot, state}) => {
      let slots = [];
      for (
        let i = bot.currentWindow.inventoryStart;
        i < bot.currentWindow.inventoryEnd;
        i++
      ) {
        const slot = bot.currentWindow.slots[i];
        if (slot && state.itemFilter(slot)) {
          slots.push(i);
        }
      }
      if (slots.length > 0) {
        for await (const slot of slots) {
          if (
            !bot.currentWindow ||
                    bot.currentWindow.slots.slice(0, bot.currentWindow.inventoryStart).every((slot) => slot === null))
            break;
          bot.clickWindow(slot, 0, 0);
          await bot.waitForTicks(1);
        }
      }
    },
  },
  {
    name: 'Closing incorrect window',
    when: ({bot, state}) => {
      const title = bot.getWindowTitle();
      return !title.includes(state.username) && !title.includes(bot.transferItems.config.giftConfirmWindowTitle.toLowerCase());
    },
    run: async ({bot}) => {
      bot.closeWindow(bot.currentWindow);
      await bot.waitForTicks(5);
    },
  },
];

module.exports = giftBehaviour;
