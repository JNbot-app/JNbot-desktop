const {
  closeWindow,
  containerIsEmpty,
  fill,
  findSlot,
  hasTransferableItem,
  parseKeys,
  transferableSlots,
  windowTitleMatches,
} = require('./transferUtil');

const OWNED = /keys own:\s*(\d+)/i;
const SENDING = /keys being sent:\s*(\d+)/i;

const cfg = (bot) => bot.transfer.config.gift;
const inDepositWindow = (bot) => windowTitleMatches(bot, cfg(bot).depositWindowTitle);
const inConfirmWindow = (bot) => windowTitleMatches(bot, cfg(bot).confirmWindowTitle);
const keyItems = (bot, name) => bot.items({ name, lore: OWNED }).container();
const loreNumber = (bot, item, pattern) =>
  Number(pattern.exec(bot.cleanText(bot.itemInfo.lore(item)))?.[1] ?? 0);

/** Adds `amount` of `key` to the gift, one click per key. */
async function addKey(bot, key, amount) {
  const names = [key, ...(bot.transfer.config.keyAliases[key] ?? [])];
  const item = keyItems(bot, names).first();
  if (!item) return log(`Couldn't find ${key} keys, sending the gift without them`, 'warning');

  const owned = loreNumber(bot, item, OWNED);
  if (owned < amount) log(`Only ${owned}/${amount} ${key} keys available`, 'warning');
  const clicks = Math.min(amount, owned) - loreNumber(bot, item, SENDING);
  for (let i = 0; i < clicks; i++) {
    bot.clickWindow(item.slot, 0, 0);
    await bot.waitForTicks(4);
  }
}

async function sendGift(bot) {
  bot.closeWindow(bot.currentWindow);
  await bot.onceWithTimeout('windowOpen', 20);
}

/**
 * Gift items to `state.username`. With `withKeys`, the crate keys in
 * `state.keys` are added through the key page right before the gift is sent.
 */
function createGiftBehaviour({ withKeys = false } = {}) {
  const keysPending = (state) => withKeys && state.pendingKeys.length > 0;
  const readyToSend = (bot, state) =>
    inDepositWindow(bot) && (!hasTransferableItem(bot, state) || containerIsEmpty(bot));

  const keyTasks = [
    {
      name: 'Adding keys',
      when: ({ bot }) => keyItems(bot).has(),
      run: async ({ bot, state }) => {
        for (const [key, amount] of state.pendingKeys) await addKey(bot, key, amount);
        state.pendingKeys = [];
        await sendGift(bot);
      },
    },
    {
      name: 'Opening key page',
      when: ({ bot, state }) => keysPending(state) && readyToSend(bot, state),
      run: async ({ bot, state }) => {
        if (!(await bot.items(cfg(bot).keyButton).container().click())) {
          log('This gift window has no key option, sending the gift without keys', 'warning');
          state.pendingKeys = [];
          return;
        }
        await keyItems(bot).wait(40);
      },
    },
  ];

  return [
    {
      name: 'Opening gift window',
      when: ({ bot }) => !bot.currentWindow,
      run: async ({ bot, state, machine }) => {
        if (withKeys) state.pendingKeys ??= parseKeys(state.keys);
        const forceKeys = state.forceKeys && keysPending(state);
        if (!forceKeys && !hasTransferableItem(bot, state)) return machine.finish();
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
    ...(withKeys ? keyTasks : []),
    {
      name: 'Sending gift',
      when: ({ bot, state }) => readyToSend(bot, state),
      run: ({ bot }) => sendGift(bot),
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
}

module.exports = createGiftBehaviour;
