
 function hasTradeableItem(bot, targets) {
  const window = bot.currentWindow ?? bot.inventory;
    for (
      let i = window.inventoryStart;
      i < window.inventoryEnd;
      i++
    ) {
      const slot = window.slots[i];
      if (slot && targets.itemFilter(slot)) return true;
    }
  return false;
};

function hasAcceptedTrade({bot, state}) {
  const slot = bot.currentWindow.slots[state.__acceptSlot];
  return slot && isGreenGlass(slot);
}

function isGreenGlass(slot) {
  return (
    slot.name === 'green_stained_glass_pane' ||
    (slot.name.includes('glass') &&
      (slot.metadata === 5 || slot.metadata === 13))
  );
}

function traderAccepted(bot, state) {
  const slot = bot.currentWindow.slots[state.__acceptSlot + 6];
  return slot && isGreenGlass(slot);
}



module.exports = {
  hasTradeableItem,
  traderAccepted,
  isGreenGlass,
  hasAcceptedTrade,
};

