const normalize = (text) => String(text ?? '').replace(/§./g, '').toLowerCase();

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);

/** Whether `text` contains a (filled-in) pattern; see transferConfig.js. */
function textMatches(text, pattern, vars = {}) {
  if (Array.isArray(pattern)) return pattern.some((p) => textMatches(text, p, vars));
  if (typeof pattern === 'function') return pattern(text);
  return normalize(text).includes(normalize(fill(pattern, vars)));
}

function itemMatches(bot, item, matcher) {
  if (!item) return false;
  if (Array.isArray(matcher)) return matcher.some((m) => itemMatches(bot, item, m));
  if (typeof matcher === 'function') return matcher(item, bot);
  const { name, info } = bot.itemInfo(item);
  return textMatches(`${item.name}\n${name}\n${info}`, matcher);
}

const windowTitleMatches = (bot, pattern, vars) =>
  !!bot.currentWindow && textMatches(bot.getWindowTitle(), pattern, vars);

/** Slot ids of the bot's own inventory items that should be transferred. */
function transferableSlots(bot, state) {
  const window = bot.currentWindow ?? bot.inventory;
  const slots = [];
  for (let i = window.inventoryStart; i < window.inventoryEnd; i++) {
    if (window.slots[i] && state.itemFilter(window.slots[i])) slots.push(i);
  }
  return slots;
}

const hasTransferableItem = (bot, state) => transferableSlots(bot, state).length > 0;

/** First container slot (in `slotIds`, default all) holding a matching item. */
function findSlot(bot, matcher, slotIds) {
  const window = bot.currentWindow;
  slotIds ??= Array.from({ length: window.inventoryStart }, (_, i) => i);
  return slotIds.find((i) => itemMatches(bot, window.slots[i], matcher)) ?? null;
}

const containerIsEmpty = (bot) =>
  bot.currentWindow.slots.slice(0, bot.currentWindow.inventoryStart).every((s) => !s);

const hasFreeContainerSlot = (bot) =>
  bot.currentWindow.slots.slice(0, bot.currentWindow.inventoryStart).includes(null);

async function closeWindow(bot, ticks = 5) {
  if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
  await bot.waitForTicks(ticks);
}

module.exports = {
  fill,
  textMatches,
  itemMatches,
  windowTitleMatches,
  transferableSlots,
  hasTransferableItem,
  findSlot,
  containerIsEmpty,
  hasFreeContainerSlot,
  closeWindow,
};
