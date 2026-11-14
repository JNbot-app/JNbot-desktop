const {
  closeWindow,
  findSlot,
  hasFreeContainerSlot,
  hasTransferableItem,
  transferableSlots,
  windowTitleMatches,
} = require('./transferUtil');

/**
 * Move items into a server window opened by `state.command`. With `trash`,
 * the window comes from the trash config and is confirmed when done.
 */
function createWindowBehaviour({ trash = false } = {}) {
  const trashCfg = (bot) => bot.transfer.config.trash;
  const command = (bot, state) => (trash ? trashCfg(bot).command : state.command);

  const tasks = [
    {
      name: 'Opening window',
      when: ({ bot }) => !bot.currentWindow,
      run: async ({ bot, state, machine }) => {
        if (!hasTransferableItem(bot, state)) return machine.finish();
        await bot.openWindow(command(bot, state), { ticks: 30 });
      },
    },
  ];

  if (trash) {
    tasks.push(
      {
        name: 'Closing incorrect window',
        when: ({ bot }) => !windowTitleMatches(bot, trashCfg(bot).windowTitle),
        run: ({ bot }) => closeWindow(bot, 20),
      },
      {
        name: 'Confirming trash',
        when: ({ bot, state }) => !hasTransferableItem(bot, state) || !hasFreeContainerSlot(bot),
        run: async ({ bot, machine }) => {
          const end = bot.currentWindow.inventoryStart;
          const bottomRow = Array.from({ length: 9 }, (_, i) => end - 9 + i);
          const slot = findSlot(bot, trashCfg(bot).confirmButton, bottomRow);
          if (slot !== null) {
            bot.clickWindow(slot, 0, 0);
            await bot.onceWithTimeout('windowClose', 5);
          }
          await closeWindow(bot, 2);
          machine.finish();
        },
      },
    );
  } else {
    tasks.push({
      name: 'Finished transferring items',
      when: ({ bot, state }) => !hasTransferableItem(bot, state) || !hasFreeContainerSlot(bot),
      run: ({ machine }) => machine.finish(),
    });
  }

  tasks.push({
    name: 'Depositing item',
    when: () => true,
    run: async ({ bot, state }) => {
      const [slot] = transferableSlots(bot, state);
      if (state.shiftClick) {
        bot.clickWindow(slot, 0, 1);
        await bot.waitForTicks(2);
      } else {
        const freeSlot = bot.currentWindow.slots.indexOf(null);
        await bot.moveSlotItem(slot, freeSlot);
      }
    },
  });

  return tasks;
}

module.exports = createWindowBehaviour;
