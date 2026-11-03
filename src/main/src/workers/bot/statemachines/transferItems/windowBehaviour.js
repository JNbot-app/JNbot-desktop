
const {hasTradeableItem} = require("./transferUtil")

function getFreeWindowSpot(bot, lastSlot) {
  for (let i = lastSlot; i < bot.currentWindow.inventoryStart; i++) {
    if (bot.currentWindow.slots[i] === null) return i;
  }
  return null;
}

const windowBehaviour = [
  {
    name: 'Opening window',
    when: ({bot}) => !bot.currentWindow,
    run: async ({bot, state, machine}) => {
      if (hasTradeableItem(bot, state)) {
        await bot.openWindow(state.command, { ticks: 30 });
      } else {
        machine.finish();
      }
    },
  },
  {
    name: 'Finished transfering items',
    when: ({bot, state}) =>
      !hasTradeableItem(bot, state) || getFreeWindowSpot(bot, 0) === null,
    run: async ({bot, state, machine}) => {
      machine.finish();
    },
  },
  {
    name: 'Depositing items',
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

module.exports = windowBehaviour;
