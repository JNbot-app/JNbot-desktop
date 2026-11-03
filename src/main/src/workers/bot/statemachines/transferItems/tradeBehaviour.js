const StateMachine = require('../Statemachine');
const {
  hasTradeableItem,
  hasAcceptedTrade,
  isGreenGlass,
  traderAccepted,
} = require('./transferUtil');


function tradeIsFull(bot,state) {
  let window = bot?.currentWindow;
  let slots = window.slots;

  for (
    let i = 0;
    i < state.__acceptSlot - (state.__acceptSlot % 9);
    i += 9
  ) {
    for (let j = 0; j < 4; j++) {
      if (slots[i + j] === null) {
        return false;
      }
    }
  }
  return true;
}


function sleep(x){
  return new Promise(resolve => setTimeout(resolve, x));
}

function once(bot,eventName, timeout) {
  return new Promise(async (r) => {
    const end = (...args) => r(args);
    bot.once(eventName, end);
    await bot.waitForTicks(timeout);
    bot.removeListener(eventName, end);
    r(true);
  });
}

const tradeBehaviour = [
  {
    name: 'Opening trade window',
    when: ({bot}) => !bot.currentWindow,
    run: async ({bot, state, machine}) => {
      if (!hasTradeableItem(bot, state)) {
        machine.finish();
      } else {
        await bot.openWindow(bot.transferItems.config.tradeCommand.replace("<username>", state.username));
      }
    },
  },
  {
    name: 'Closing incorrect window',
    when: ({bot, state}) =>
      !bot.getWindowTitle().includes(state.username),
    run: async ({bot}) => {
      bot.closeWindow(bot.currentWindow);
      await bot.waitForTicks(5);
    },
  },
  {
    name: 'Searching for accept slot',
    when: ({bot, state}) => isNaN(state.__acceptSlot),
    run: async ({bot, state}) => {
      for (let i = 0; i < bot.currentWindow.inventoryStart; i += 9) {
        for (let j = 0; j < 4; j++) {
          const slot = bot.currentWindow.slots[i + j];
          if (slot && slot.name.includes('glass')) {
            state.__acceptSlot = i + j;
            return;
          }
        }
      }
      log("Couldn't find accept slot, using default", 'warning');
      state.__acceptSlot = bot.transferItems.config.tradeAcceptSlotDefault;
    },
  },
  {
    name: 'Waiting for trade window to finish',
    when: hasAcceptedTrade,
    run: async () => {
      await sleep(200);
    },
  },
  {
    name: 'Accepting trade',
    when: ({bot, state}) =>
      !hasTradeableItem(bot, state) ||
      tradeIsFull(bot, state) ||
      traderAccepted(bot, state),
    run: async ({bot, state}) => {
      bot.clickWindow(state.__acceptSlot, 0, 0);
      await bot.waitForTicks(10);
    },
  },
  {
    name: 'Depositing items',
    when: () => true,
    run: async ({bot, state}) => {
      let items = [];
      for (
        let i = bot.currentWindow.inventoryStart;
        i < bot.currentWindow.inventoryEnd;
        i++
      ) {
        const slot = bot.currentWindow.slots[i];
        if (slot && state.itemFilter(slot)) {
          items.push(i);
        }
      }

      for (let slot of items) {
        if (
          !bot.currentWindow ||
          bot.currentWindow.slots[
            Math.floor(state.__acceptSlot / 9) * 9 - 6
          ] !== null || // Check if last slot of trade is full
          isGreenGlass(bot.currentWindow.slots[state.__acceptSlot + 6])
        )
          return;

        bot.clickWindow?.(slot, 0, 0); // Only works for 1.8.x - 1.16.x

        await bot?.waitForTicks(1);
      }
    },
  },
];

module.exports = tradeBehaviour;
