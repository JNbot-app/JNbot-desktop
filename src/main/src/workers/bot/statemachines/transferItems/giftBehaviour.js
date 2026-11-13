const {
  closeWindow,
  containerIsEmpty,
  fill,
  findSlot,
  hasTransferableItem,
  transferableSlots,
  windowTitleMatches,
} = require('./transferUtil');

const cfg = (bot) => bot.transferItems.config.gift;
const inDepositWindow = (bot) => windowTitleMatches(bot, cfg(bot).depositWindowTitle);
const inConfirmWindow = (bot) => windowTitleMatches(bot, cfg(bot).confirmWindowTitle);

const giftBehaviour = [
  {
    name: 'Opening gift window',
    when: ({ bot }) => !bot.currentWindow,
    run: async ({ bot, state, machine }) => {
      if (!hasTransferableItem(bot, state)) return machine.finish();
      await bot.openWindow(fill(cfg(bot).command, state), { timeout: 10_000 });
      if (!bot.currentWindow) {
        log(`[${bot.username}] Failed to open the gift window`, 'error');
        machine.finish();
      }
    },
  },
  {
    name: 'Confirming gift',
    when: ({ bot }) => inConfirmWindow(bot),
    run: ({ bot }) => {
      let slot = findSlot(bot, cfg(bot).confirmButton);
      if (slot === null) {
        log(`Couldn't find the gift confirm button in "${bot.getWindowTitle()}"`, 'warning');
        slot = cfg(bot).confirmSlot;
      }
      bot.clickWindow(slot, 0, 0);
    },
  },
  {
    name: 'Sending gift',
    when: ({ bot, state }) =>
      inDepositWindow(bot) && (!hasTransferableItem(bot, state) || containerIsEmpty(bot)),
    run: async ({ bot }) => {
      bot.closeWindow(bot.currentWindow);
      await bot.onceWithTimeout('windowOpen', 20);
    },
  },
  {
    name: 'Depositing items',
    when: ({ bot }) => inDepositWindow(bot),
    run: async ({ bot, state }) => {
      for (const slot of transferableSlots(bot, state)) {
        if (!bot.currentWindow || containerIsEmpty(bot)) return;
        bot.clickWindow(slot, 0, 0);
        await bot.waitForTicks(1);
      }
    },
  },
  {
    name: 'Closing incorrect window',
    when: ({ bot, state }) => !windowTitleMatches(bot, cfg(bot).windowTitle, state),
    run: ({ bot }) => closeWindow(bot),
  },
];

module.exports = giftBehaviour;
