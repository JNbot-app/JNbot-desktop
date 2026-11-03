const assert = require('assert');
const { getOrAskTransferToUsername } = require('../lib/MissingDataHandler');
const { default: BotMachine } = require('./statemachines/BotMachine');

const transferMode = [
  () => require('./statemachines/transferItems/tradeBehaviour'),
  () => require('./statemachines/transferItems/giftBehaviour'),
  () => require('./statemachines/transferItems/windowBehaviour'),
  () => require('./statemachines/transferItems/tradeWithKeysBehaviour'),
  () => require('./statemachines/transferItems/trashBehaviour'),
];

const modes = {
  keep: 0,
  trade: 1,
  gift: 2,
  window: 3,
  tradeWithKeys: 4,
  trash: 5,
};

const inject = (bot) => {
  async function transferItems(mode, options = {}) {
    if (typeof mode === 'string') mode = modes[mode];

    assert(!isNaN(mode), 'Mode must be a number');
    assert(
      mode >= 0 && mode <= transferMode.length,
      'Mode must be between 0 and ' + transferMode.length,
    );
    if (mode === 0) return;
    assert(typeof options === 'object', 'Options must be an object');

    if (mode !== 3 && mode !== 5 && typeof options.username !== 'string') {
      options.username = await getOrAskTransferToUsername();
    }

    assert(
      mode === 3 || mode === 5 || typeof options.username === 'string',
      'No username was provided for item transfer',
    );
    assert(
      !options.command ||
        (typeof options.command === 'string' &&
          options.command.startsWith('/')),
      'A command must start with "/"',
    );
    assert(
      transferMode[mode - 1],
      'Mode not found, choose between 1 and ' + transferMode.length,
    );
    assert(
      !options.keys || Array.isArray(options.keys),
      'Keys must be an array if integers',
    );

    let {
      username,
      command,
      ignore = [],
      filter = [],
      itemFilter = null, // () => boolean, if true, item will be moved
      keep = false, // whether pass the item if not filtered
      keys = ['vote,10', 'rare,5', 'ultra,2', 'god,1'], // How many items it should click on each key  ("<keyType>,<amount>")
      forceTradeKeys = true, // Whether to force trade keys even when no other items are in player inventory
      timeout = null,
      shiftClick = true, // Whether to shift click items into window (windowBehaviour only)
      transferConfig = {}
    } = options;

    assert(Array.isArray(ignore), 'Ignore must be an array');
    assert(Array.isArray(filter), 'Filter must be an array');

    ignore = new Set(ignore);
    filter = new Set(filter);

    return new Promise(async (resolve) => {
      function filterItems(item) {
        // Skip item if: item is null
        //              item is in ignore list
        //              item is not in filter list
        //              itemFilter returns false
        if (item === null || ignore.has(item.name) || ignore.has(item.type))
          return false;
        if (filter.size > 0 && (filter.has(item.name) || filter.has(item.type)))
          return true;
        if (typeof itemFilter === 'function') return itemFilter(item);
        if (ignore.size && !filter.size) return true;
        if (filter.size && !ignore.size) return false;
        return !keep;
      }
      let timeoutId = null;
      if (mode === 2) {
        forceTradeKeys = false;
        keys = undefined;
      }

      


      const botMachine = new BotMachine(transferMode[mode - 1](), {
        state: {
          username,
          command,
          keys,
          shiftClick,
          forceTradeKeys,
          itemFilter: filterItems,
        },
        bot,
        disableAutoReconnect: true,
      }).onFinish(() => {
        clearTimeout(timeoutId);
        resolve(true);
      }).start()

      if (timeout)
        timeoutId = setTimeout(() => {
          botMachine.finish();
          log('Transfer timed out');
          resolve(false);
        }, timeout);
    });
  }

  bot.transferItems = transferItems;
  bot.transferItems.trade = (options = {}) => transferItems('trade', options);
  bot.transferItems.gift = (options = {}) => transferItems('gift', options);
  bot.transferItems.window = (options = {}) => transferItems('window', options);
  bot.transferItems.tradeWithKeys = (options = {}) =>
    transferItems('tradeWithKeys', options);
  bot.transferItems.trash = (options = {}) => transferItems('trash', options);
  bot.transferItems.config = {
    trashCommand: "/trash",
    trashWindowTitles: ["trash", "disposal"],
    trashItemConfirmText: "delete all items",

    tradeCommand: "/trade <username>",
    tradeAcceptSlotDefault: 45,

    giftConfirmWindowTitle: "Are you sure?",
    giftDepositWindowTitle: "Select items to send"
  }


};

module.exports = inject;
