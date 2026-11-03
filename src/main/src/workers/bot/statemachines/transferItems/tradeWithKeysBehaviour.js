const StateMachine = require('../Statemachine');
const { hasTradeableItem } = require('./transferUtil');

function hasAcceptedTrade({bot, state}) {
  const slot = bot.currentWindow.slots[state.__acceptSlot];
  return slot && isGreenGlass(slot);
}

function isGreenGlass(slot) {
  return (
    slot.name === 'green_stained_glass_pane' ||
    slot.name === 'lime_stained_glass_pane' ||
    (slot.name.includes('glass') &&
      (slot.metadata === 5 || slot.metadata === 13))
  );
}

function traderAccepted(bot, state) {
  const slot = bot.currentWindow.slots[state.__acceptSlot + 6];
  return slot && isGreenGlass(slot);
}

function tradeIsFull(bot, state) {
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

function clickOnKey(bot, n, slot) {
  return new Promise((resolve) => {
    let i = 0;
    let interval = setInterval(() => {
      if (i >= n || !bot?.currentWindow) {
        clearInterval(interval);
        return resolve();
      }
      bot.clickWindow?.(slot, 0, 0);
      i++;
    });
  });
}

function countTripwires(bot, startSlot) {
  if(!bot.currentWindow) return 0;
  let count = 0;
  const end = bot.currentWindow.inventoryStart
  for (let i = startSlot; i < end; i++) {
    const slot = bot.currentWindow.slots[i];
    if (slot && slot.name === 'tripwire_hook') {
      count++;
    }
  }
  return count;
}

function sleep(x) {
  return new Promise((resolve) => setTimeout(resolve, x));
}

function once(bot, eventName, timeout) {
  return new Promise(async (r) => {
    const end = (...args) => r(args);
    bot.once(eventName, end);
    await bot.waitForTicks(timeout);
    bot.removeListener(eventName, end);
    r(true);
  });
}

const tradeWithKeysBehaviour = [
  {
    name: 'Opening trade window',
    when: ({bot}) => !bot.currentWindow,
    run: async ({bot, state, machine}) => {
      if (!state.forceTradeKeys && !hasTradeableItem(bot, state)) {
        machine.finish();
      } else {
        bot.chat('/trade ' + state.username);
        await once(bot, 'windowOpen', 100);
      }
    },
  },
  {
    name: 'Closing incorrect window',
    when: ({bot, state}) =>
      !bot.getWindowTitle().toLowerCase().includes(state.username.toLowerCase()),
    run: async ({bot}) => {
      bot.closeWindow(bot.currentWindow);
      await bot.waitForTicks(5);
    },
  },
  {
    name: 'Mapping inventory slots',
    when: ({bot, state}) =>
      isNaN(state.__acceptSlot) ||
      isNaN(state.__keySlot) ||
      isNaN(state.__keyTypes),
    run: async ({bot, state}) => {
      state.__acceptSlot = null;
      for (let i = 0; i < bot.currentWindow.inventoryStart; i += 9) {
        for (let j = 0; j < 4; j++) {
          const slotID = i + j;
          const slot = bot.currentWindow.slots[slotID];
          if (!slot) continue;
          const itemInfo = bot
            .itemInfo(slot)
            .info.replace(/§./g, '')
            .toLowerCase();

          if (slot.name.includes('glass')) {
            state.__acceptSlot = slotID;
            break;
          } else if ((itemInfo.includes('cycle through') || itemInfo.includes('click to manage crate key') ) && !state.__keySlot && itemInfo.includes("keys")) {
            state.__keySlot = slotID;
            break;
          }/* else if (itemInfo.includes('to this trade')) {
            state.__keyTypes = slotID;
            break;
          }*/
        }
      }

      if (!state.__acceptSlot) {
        log("Couldn't find accept slot, using default", 'warning');
        state.__acceptSlot = 27;
      }
      if (!state.__keySlot) {
        log("Couldn't find key slot, using default", 'warning');
        state.__keySlot = 36;
        for(let i = bot.currentWindow.inventoryStart-1; i >= 0; i--) {
          const slot = bot.currentWindow.slots[i];
          if (!slot || slot.name  !== "tripwire_hook") continue;
          state.__keySlot = i;
          break;
        }
      }
      state.__keyTypes = state.__keySlot + 9 - state.__keySlot % 9;
      state.keys ??= ['vote,10', 'rare,5', 'ultra,2', 'god,1'];
      state.keys = state.keys.map(k => k.toLowerCase());

      let keysToTransfer = [];
        // parse keys
        state.keys.forEach((element) => {
          if(typeof element !== 'string') return global.log('Invalid key format, you are most likely still using the old key setting format, please update the key settings', 'error');

          let [key, amount] = element.split(',');
          if (!key || !amount) return;
          amount = parseInt(amount.replace(/[^0-9]/g, ''));
          if (amount <= 0) return;
          keysToTransfer.push([key, amount]);
        });

      state.__keys = keysToTransfer;
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
      !state.forceTradeKeys &&
      (!hasTradeableItem(bot, state) ||
        tradeIsFull(bot, state) ||
        traderAccepted(bot, state)),
    run: async ({bot, state}) => {
      bot.clickWindow(state.__acceptSlot, 0, 0);
      await bot.waitForTicks(5);
    },
  },
  {
    name: "Clicking on key slot",
    when: ({bot, state}) => countTripwires(bot, state.__keyTypes) === 0,
    run: async ({bot, state}) => {
      bot.clickWindow(state.__keySlot, 0, 0);
      await bot.waitForTicks(10);
    }
  },
  {
    name: 'Transfering virtual keys',
    when: ({state}) => !!state.__keys?.length,
    run: async ({bot, state}) => {
      const [key, amount] = state.__keys[0];
      let success = false;
      for (let i = state.__keyTypes; i < bot.currentWindow.inventoryStart; i++) {
        const slot = bot.currentWindow.slots[ i];
        if (!slot || slot.name !== "tripwire_hook") continue;
        const itemInfo = bot
          .itemInfo(slot)
          .name.replace(/§./g, '')
          .toLowerCase();

        if (
          !itemInfo.includes(key) &&
          (key !== 'vote' || !itemInfo.includes('voting')) // FIXME: should this be here? trading vote keys in lifesteal is an issue.
        )
          continue;
        success = true;
        log(`Clicking ${amount} time on ${key} key`);
        for (let j = 0; j < amount; j++) {
          bot.clickWindow(i, 0, 0);
          await bot.waitForTicks(4);
        }
        break;
      }

      if (!success) {
        log(`Couldn't find ${key} keys, going to next key page`, 'warning');
        bot.clickWindow(state.__keySlot, 0, 0);
        await bot.waitForTicks(10);
      } else {
        state.__keys.shift();
      }
    },
  },
  {
    name: 'Depositing items',
    when: () => true,
    run: async ({bot, state}) => {
      state.forceTradeKeys = false;
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
          break;

        bot.clickWindow?.(slot, 0, 0);

        await bot?.waitForTicks(1);
      }
    },
  },
];

module.exports = tradeWithKeysBehaviour;
