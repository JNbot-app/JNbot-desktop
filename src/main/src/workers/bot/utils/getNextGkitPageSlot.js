function getNextGkitPageSlot(bot) {
  if (!bot.currentWindow) return -1;

  let lastSlot = bot.currentWindow.inventoryStart;
  for (let i = lastSlot - 9; i < lastSlot; i++) {
    const slot = bot.currentWindow.slots[i];
    if (slot && bot.itemInfo(slot).name.toLowerCase().includes('next page')) {
      return i;
    }
  }

  // In OPfactions, the next page button is an arrow at position 35 | 26, let's check for that as well

  const arrowSlot = bot.currentWindow.slots[35] ? 35 : 26;
  const nextPageSlot = bot.currentWindow.slots[arrowSlot];
  if (nextPageSlot && nextPageSlot.name === 'arrow') {
    return arrowSlot;
  }

    return -1;
}

module.exports = getNextGkitPageSlot;