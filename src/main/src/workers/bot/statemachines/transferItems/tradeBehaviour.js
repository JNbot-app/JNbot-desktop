const {
  closeWindow,
  fill,
  findSlot,
  hasTransferableItem,
  itemMatches,
  textMatches,
  transferableSlots,
  windowTitleMatches,
} = require('./transferUtil');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** "vote,10" -> ['vote', 10]; invalid entries are skipped. */
function parseKeys(keys = []) {
  return keys.flatMap((entry) => {
    if (typeof entry !== 'string') {
      log('Invalid key format, use "<keyType>,<amount>" (e.g. "vote,10")', 'error');
      return [];
    }
    const [key, amount] = entry.toLowerCase().split(',');
    const count = parseInt(amount?.replace(/\D/g, ''), 10);
    return key && count > 0 ? [[key.trim(), count]] : [];
  });
}

/** Slot ids of your side of the trade: the rows above the accept button. */
function offerSlots(acceptSlot, columns) {
  const slots = [];
  for (let row = 0; row < acceptSlot - (acceptSlot % 9); row += 9) {
    for (let col = 0; col < columns; col++) slots.push(row + col);
  }
  return slots;
}

/**
 * Trade items with `state.username`. With `withKeys`, it also offers the
 * virtual crate keys in `state.keys` before depositing items.
 */
function createTradeBehaviour({ withKeys = false } = {}) {
  const cfg = (bot) => bot.transferItems.config.trade;
  const keyCfg = (bot) => bot.transferItems.config.tradeWithKeys;
  const slotOf = (bot, offset) => bot.currentWindow.slots[offset];

  const accepted = (bot, slot) => itemMatches(bot, slotOf(bot, slot), cfg(bot).acceptedButton);
  const partnerAccepted = (bot, state) =>
    accepted(bot, state.acceptSlot + cfg(bot).partnerAcceptOffset);
  const tradeIsFull = (bot, state) => state.offerSlots.every((i) => slotOf(bot, i));
  const keyItemSlots = (bot, state) => {
    const slots = [];
    for (let i = state.keyTypesStart; i < bot.currentWindow.inventoryStart; i++) {
      if (itemMatches(bot, slotOf(bot, i), keyCfg(bot).keyItem)) slots.push(i);
    }
    return slots;
  };

  function mapTradeWindow(bot, state) {
    const config = cfg(bot);
    const sideSlots = offerSlots(bot.currentWindow.inventoryStart, config.offerColumns);
    // The key window has decorations above the accept button, so search bottom-up there.
    const acceptSearch = withKeys ? [...sideSlots].reverse() : sideSlots;
    state.acceptSlot = findSlot(bot, config.acceptButton, acceptSearch);
    if (state.acceptSlot === null) {
      log("Couldn't find the trade accept button, using the default slot", 'warning');
      state.acceptSlot = withKeys ? keyCfg(bot).acceptSlot : config.acceptSlot;
    }
    state.offerSlots = offerSlots(state.acceptSlot, config.offerColumns);
    if (!withKeys) return;

    const keys = keyCfg(bot);
    const keyItemSlotsDesc = Array.from(
      { length: bot.currentWindow.inventoryStart },
      (_, i) => bot.currentWindow.inventoryStart - 1 - i,
    );
    state.keySlot =
      findSlot(bot, keys.keyButton, [...sideSlots].reverse()) ??
      findSlot(bot, keys.keyItem, keyItemSlotsDesc);
    if (state.keySlot === null) {
      log("Couldn't find the key button, using the default slot", 'warning');
      state.keySlot = keys.keySlot;
    }
    state.keyTypesStart = state.keySlot + 9 - (state.keySlot % 9);
    state.pendingKeys = parseKeys(state.keys);
  }

  const tasks = [
    {
      name: 'Opening trade window',
      when: ({ bot }) => !bot.currentWindow,
      run: async ({ bot, state, machine }) => {
        const keysLeft = withKeys && state.forceTradeKeys;
        if (!keysLeft && !hasTransferableItem(bot, state)) return machine.finish();
        await bot.openWindow(fill(cfg(bot).command, state));
      },
    },
    {
      name: 'Closing incorrect window',
      when: ({ bot, state }) =>
        !windowTitleMatches(bot, cfg(bot).windowTitle, state),
      run: ({ bot }) => closeWindow(bot),
    },
    {
      name: 'Mapping trade window',
      when: ({ state }) => state.acceptSlot == null,
      run: ({ bot, state }) => mapTradeWindow(bot, state),
    },
    {
      name: 'Waiting for trade to finish',
      when: ({ bot, state }) => accepted(bot, state.acceptSlot),
      run: () => sleep(200),
    },
    {
      name: 'Accepting trade',
      when: ({ bot, state }) =>
        !(withKeys && state.forceTradeKeys) &&
        (!hasTransferableItem(bot, state) ||
          tradeIsFull(bot, state) ||
          partnerAccepted(bot, state)),
      run: async ({ bot, state }) => {
        bot.clickWindow(state.acceptSlot, 0, 0);
        await bot.waitForTicks(withKeys ? 5 : 10);
      },
    },
  ];

  if (withKeys) {
    tasks.push(
      {
        name: 'Opening key page',
        when: ({ bot, state }) => keyItemSlots(bot, state).length === 0,
        run: async ({ bot, state }) => {
          bot.clickWindow(state.keySlot, 0, 0);
          await bot.waitForTicks(10);
        },
      },
      {
        name: 'Offering virtual keys',
        when: ({ state }) => state.pendingKeys.length > 0,
        run: async ({ bot, state }) => {
          const [key, amount] = state.pendingKeys[0];
          const names = [key, ...(keyCfg(bot).keyAliases[key] ?? [])];
          const slot = keyItemSlots(bot, state).find((i) =>
            textMatches(bot.itemInfo.name(slotOf(bot, i)), names),
          );
          if (slot === undefined) {
            log(`Couldn't find ${key} keys, going to the next key page`, 'warning');
            bot.clickWindow(state.keySlot, 0, 0);
            await bot.waitForTicks(10);
            return;
          }
          log(`Clicking ${amount} times on the ${key} key`);
          for (let i = 0; i < amount; i++) {
            bot.clickWindow(slot, 0, 0);
            await bot.waitForTicks(4);
          }
          state.pendingKeys.shift();
        },
      },
    );
  }

  tasks.push({
    name: 'Depositing items',
    when: () => true,
    run: async ({ bot, state }) => {
      state.forceTradeKeys = false;
      for (const slot of transferableSlots(bot, state)) {
        if (!bot.currentWindow || tradeIsFull(bot, state) || partnerAccepted(bot, state)) return;
        bot.clickWindow(slot, 0, 0);
        await bot.waitForTicks(1);
      }
    },
  });

  return tasks;
}

module.exports = createTradeBehaviour;
