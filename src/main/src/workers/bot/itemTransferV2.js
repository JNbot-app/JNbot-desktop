const assert = require('assert');
const { getOrAskTransferToUsername } = require('../lib/MissingDataHandler');
const { default: BotMachine } = require('./statemachines/BotMachine');
const createTradeBehaviour = require('./statemachines/transferItems/tradeBehaviour');
const giftBehaviour = require('./statemachines/transferItems/giftBehaviour');
const createWindowBehaviour = require('./statemachines/transferItems/windowBehaviour');
const { cloneConfig, mergeConfig } = require('./statemachines/transferItems/transferConfig');

// Index = legacy numeric mode id.
const MODES = ['keep', 'trade', 'gift', 'window', 'tradeWithKeys', 'trash'];
const BEHAVIOURS = {
  trade: () => createTradeBehaviour(),
  gift: () => giftBehaviour,
  window: () => createWindowBehaviour(),
  tradeWithKeys: () => createTradeBehaviour({ withKeys: true }),
  trash: () => createWindowBehaviour({ trash: true }),
};
const NEEDS_USERNAME = new Set(['trade', 'gift', 'tradeWithKeys']);
const DEFAULT_KEYS = ['vote,10', 'rare,5', 'ultra,2', 'god,1'];

/** Whether an inventory item should be transferred. */
function createItemFilter({ ignore = [], filter = [], itemFilter = null, keep = false }) {
  assert(Array.isArray(ignore), 'Ignore must be an array');
  assert(Array.isArray(filter), 'Filter must be an array');
  const ignored = new Set(ignore);
  const wanted = new Set(filter);
  const listed = (set, item) => set.has(item.name) || set.has(item.type);

  return (item) => {
    if (!item || listed(ignored, item)) return false;
    if (listed(wanted, item)) return true;
    if (typeof itemFilter === 'function') return itemFilter(item);
    if (ignored.size && !wanted.size) return true;
    if (wanted.size && !ignored.size) return false;
    return !keep;
  };
}

const inject = (bot) => {
  async function transferItems(mode, options = {}) {
    const name = typeof mode === 'number' ? MODES[mode] : mode;
    assert(MODES.includes(name), `Unknown transfer mode "${mode}", use one of: ${MODES.join(', ')}`);
    if (name === 'keep') return;
    assert(options && typeof options === 'object', 'Options must be an object');

    const { command, keys = DEFAULT_KEYS, timeout = null, shiftClick = true } = options;
    let { username, forceTradeKeys = true } = options;
    if (NEEDS_USERNAME.has(name)) {
      if (typeof username !== 'string') username = await getOrAskTransferToUsername();
      assert(typeof username === 'string', 'No username was provided for item transfer');
    }
    assert(!command || (typeof command === 'string' && command.startsWith('/')), 'A command must start with "/"');
    assert(Array.isArray(keys), 'Keys must be an array of "<keyType>,<amount>" strings');
    if (name !== 'tradeWithKeys') forceTradeKeys = false;

    return new Promise((resolve) => {
      let timeoutId = null;
      const machine = new BotMachine(BEHAVIOURS[name](), {
        state: {
          username,
          command,
          keys,
          shiftClick,
          forceTradeKeys,
          itemFilter: createItemFilter(options),
        },
        bot,
        disableAutoReconnect: true,
      })
        .onFinish(() => {
          clearTimeout(timeoutId);
          resolve(true);
        })
        .start();

      if (timeout) {
        timeoutId = setTimeout(() => {
          machine.finish();
          log('Transfer timed out');
          resolve(false);
        }, timeout);
      }
    });
  }

  for (const name of MODES.slice(1)) {
    transferItems[name] = (options = {}) => transferItems(name, options);
  }
  transferItems.config = cloneConfig();
  transferItems.configure = (overrides) => mergeConfig(transferItems.config, overrides);
  transferItems.resetConfig = () => (transferItems.config = cloneConfig());

  bot.transferItems = transferItems;
};

module.exports = inject;
