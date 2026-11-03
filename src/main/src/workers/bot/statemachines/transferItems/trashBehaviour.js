
const {hasTradeableItem} = require("./transferUtil")

function getFreeWindowSpot(bot, lastSlot) {
  for (let i = lastSlot; i < bot.currentWindow.inventoryStart; i++) {
    if (bot.currentWindow.slots[i] === null) return i;
  }
  return null;
}

const trashBehaviour = [
  {
    name: 'Opening trash window',
    when: ({bot}) => !bot.currentWindow,
    run: async ({bot, state, machine}) => {
      if (hasTradeableItem(bot, state)) {
        await bot.openWindow(bot.transferItems.config.trashCommand, { ticks: 30 });
      } else {
        machine.finish();
      }
    },
  },
  {
    name: "Closing incorrect trash window",
    when: ({bot}) => {
      if (!bot.currentWindow) return false;
      const title = bot.getWindowTitle().toLowerCase()
      return !bot.transferItems.config.trashWindowTitles.some(title => title.includes(title))
    },
    run: async ({bot}) => {
      console.log("Closing " + bot.getWindowTitle() + " window")
      bot.closeWindow(bot.currentWindow);
      await bot.waitForTicks(20);
    },
  },
  {
    name: 'Finished trashing items',
    when: ({bot, state}) =>
      !hasTradeableItem(bot, state) || getFreeWindowSpot(bot, 0) === null,
    run: async ({bot, state, machine}) => {
      if (!bot.currentWindow) return machine.finish();

      // The new trash windows have confirmation buttons at the bottom

      for(let i = bot.currentWindow.inventoryStart - 9; i < bot.currentWindow.inventoryStart; i++) {
        const slot = bot.currentWindow.slots[i];
        if (!slot) continue;
        if (slot && bot.itemInfo(slot).name.toLowerCase().replace(/§./,"").includes(bot.transferItems.config.trashItemConfirmText)) {
          bot.clickWindow(slot.slot, 0, 0);
          await bot.onceWithTimeout("windowClose", 5)
          global.log("[Trash]: confirming trash slot " + slot.slot)
          break
        }
      }
      if (bot.currentWindow) {
        bot.closeWindow(bot.currentWindow)
        await bot.waitForTicks(2);
      }
      machine.finish();
    },
  },
  {
    name: 'Trashing items',
    when: ({bot, state}) => true,
    run: async ({bot, state}) => {
      let lastSlot = 0;
      for (
        let i = bot.currentWindow.inventoryStart;
        i < bot.currentWindow.inventoryEnd;
        i++
      ) {
        const slot = bot.currentWindow.slots[i];  
        if (slot && state.itemFilter(slot)) {
          const freeSlot = getFreeWindowSpot(bot, lastSlot);
          if (typeof freeSlot !== 'number') return;
          lastSlot = freeSlot;

          if (state.shiftClick) {
            bot.clickWindow(slot.slot, 0, 1);
            await bot.waitForTicks(2);
          } else {
            const inv = bot.currentWindow;
            await bot.moveSlotItem(slot.slot, freeSlot);
          }
          break;
        }
      }
    },
  },
];

module.exports = trashBehaviour;
