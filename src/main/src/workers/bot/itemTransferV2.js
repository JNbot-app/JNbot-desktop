const assert = require('assert');
const { getOrAskTransferToUsername } = require('../lib/MissingDataHandler');
const { default: BotMachine } = require('./statemachines/BotMachine');
const createTradeBehaviour = require('./statemachines/transferItems/tradeBehaviour');
const createGiftBehaviour = require('./statemachines/transferItems/giftBehaviour');
const createWindowBehaviour = require('./statemachines/transferItems/windowBehaviour');
const { cloneConfig, mergeConfig } = require('./statemachines/transferItems/transferConfig');

const withKeys = (state) => state.keys.length > 0;

/**
 * Built-in transfer modes; plugins add their own per bot with `bot.transfer.addMode`.
 * - `target`: name of the required parameter, also accepted as the plain second argument
 * - `keys`: whether the mode can send crate keys
 * - `tasks(state)`: the BotMachine tasks (or a task array); omit for a no-op mode
 */
const MODES = {
  keep: {},
  trade: { target: 'username', keys: true, tasks: (s) => createTradeBehaviour({ withKeys: withKeys(s) }) },
  gift: { target: 'username', keys: true, tasks: (s) => createGiftBehaviour({ withKeys: withKeys(s) }) },
  window: { target: 'command', tasks: () => createWindowBehaviour() },
  trash: { tasks: () => createWindowBehaviour({ trash: true }) },
};

// Index = legacy numeric mode id; 'tradeWithKeys' is trade + sendKeys.
const LEGACY_MODES = ['keep', 'trade', 'gift', 'window', 'tradeWithKeys', 'trash'];
const LEGACY_DEFAULT_KEYS = ['vote,10', 'rare,5', 'ultra,2', 'god,1'];

/** Legacy `ignore`/`filter`/`itemFilter`/`keep` options as an item predicate. */
function legacyItemFilter({ ignore = [], filter = [], itemFilter = null, keep = false }) {
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

/** Stack counts per item id of the items a query yields. */
function countItems(query) {
  const counts = new Map();
  for (const { name, displayName, count } of query) {
    const entry = counts.get(name);
    if (entry) entry.count += count;
    else counts.set(name, { name, displayName, count });
  }
  return counts;
}

/** What left the inventory between two `countItems` snapshots. */
function diffCounts(before, after) {
  const items = [];
  let count = 0;
  for (const entry of before.values()) {
    const moved = entry.count - (after.get(entry.name)?.count ?? 0);
    if (moved <= 0) continue;
    items.push({ ...entry, count: moved });
    count += moved;
  }
  return { items, count };
}

const inject = (bot) => {
  const modes = { ...MODES };
  const isFilterObject = (f) => f && typeof f === 'object' && !(f instanceof RegExp);
  /** A `bot.items` filter or query; a list holding filter objects matches when any entry matches. */
  const asQuery = (filter) => {
    if (Array.isArray(filter) && filter.some(isFilterObject)) {
      const queries = filter.map(asQuery);
      return { matches: (item) => queries.some((q) => q.matches(item)) };
    }
    return typeof filter?.matches === 'function' ? filter : bot.items(filter);
  };

  /** Runs the mode's tasks; resolves true when done, false on timeout. */
  function run(mode, state, timeout) {
    state.items ??= bot.items({ where: state.itemFilter }).inventory();
    return new Promise((resolve) => {
      let timeoutId = null;
      // Fresh task objects per run: BotMachine keeps `once` progress on them.
      const tasks = typeof mode.tasks === 'function' ? mode.tasks(state) : mode.tasks.map((t) => ({ ...t }));
      const machine = new BotMachine(tasks, { state, bot, disableAutoReconnect: true })
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

  /** Fills in (or asks for) the mode's target and validates it. */
  async function resolveTarget(name, target, value) {
    if (target === 'username') {
      if (typeof value !== 'string' || !value) value = await getOrAskTransferToUsername();
      assert(typeof value === 'string', `No username was provided for "${name}"`);
    } else if (target === 'command') {
      assert(typeof value === 'string' && value.startsWith('/'), `"${name}" needs a command starting with "/"`);
    } else if (target) {
      assert(value != null, `"${name}" needs a ${target}`);
    }
    return value;
  }

  /**
   * Transfer inventory items: `bot.transfer('gift', 'Zola', { items: 'diamond' })`.
   * The second argument is the mode's target (username, command, ...) or the options.
   * Resolves with what left the inventory.
   */
  async function transfer(modeName, target, options) {
    if (target && typeof target === 'object' && !Array.isArray(target)) [target, options] = [undefined, target];
    options ??= {};
    const mode = modes[modeName];
    assert(mode, `Unknown transfer mode "${modeName}", use one of: ${Object.keys(modes).join(', ')}`);
    if (!mode.tasks) return { completed: true, items: [], count: 0 };

    const { items, exclude, keys = [], keysWithoutItems = true, timeout = null, shiftClick = true } = options;
    assert(Array.isArray(keys), 'Keys must be an array of { keyName, amount }');
    assert(mode.keys || !keys.length, `The "${modeName}" mode can't send keys`);
    target = await resolveTarget(modeName, mode.target, target ?? (mode.target && options[mode.target]));

    const wanted = asQuery(items);
    const excluded = exclude == null ? null : asQuery(exclude);
    const state = {
      ...(mode.target && { [mode.target]: target }),
      options,
      keys,
      shiftClick,
      forceKeys: keys.length > 0 && keysWithoutItems,
      itemFilter: (item) => wanted.matches(item) && !excluded?.matches(item),
    };
    state.items = bot.items({ where: state.itemFilter }).inventory();
    const before = countItems(state.items);
    const completed = await run(mode, state, timeout);
    return { completed, ...diffCounts(before, countItems(state.items)) };
  }

  const addShortcut = (name) => {
    transfer[name] = (target, options) => transfer(name, target, options);
  };
  Object.keys(modes).forEach(addShortcut);
  Object.defineProperty(transfer, 'modes', { get: () => Object.keys(modes), enumerable: true });

  /** Adds (or replaces) a transfer mode for this bot. */
  transfer.addMode = (name, definition) => {
    assert(typeof name === 'string' && name, 'A mode needs a name');
    assert(!(name in transfer) || name in modes, `"${name}" can't be used as a mode name`);
    const { target, keys = false, tasks } = definition ?? {};
    assert(typeof tasks === 'function' || Array.isArray(tasks), `Mode "${name}" needs tasks`);
    assert(target == null || typeof target === 'string', 'A mode target must be a parameter name');
    modes[name] = { target, keys, tasks };
    addShortcut(name);
  };
  transfer.config = cloneConfig();
  transfer.configure = (overrides) => mergeConfig(transfer.config, overrides);
  transfer.resetConfig = () => (transfer.config = cloneConfig());

  /** @deprecated Use `bot.transfer(mode, target, options)` or `bot.items(...).transfer(...)`. */
  async function transferItems(mode, options = {}) {
    let name = typeof mode === 'number' ? LEGACY_MODES[mode] : mode;
    assert(LEGACY_MODES.includes(name), `Unknown transfer mode "${mode}", use one of: ${LEGACY_MODES.join(', ')}`);
    if (name === 'keep') return;
    assert(options && typeof options === 'object', 'Options must be an object');

    let { username, command, sendKeys = false, keys = LEGACY_DEFAULT_KEYS } = options;
    if (name === 'tradeWithKeys') [name, sendKeys] = ['trade', true];
    if (MODES[name].target === 'username') username = await resolveTarget(name, 'username', username);
    else if (command) command = await resolveTarget(name, 'command', command);
    assert(Array.isArray(keys), 'Keys must be an array of "<keyType>,<amount>" strings');
    sendKeys &&= keys.length > 0;

    return run(
      MODES[name],
      {
        username,
        command,
        options,
        keys: sendKeys ? keys : [],
        shiftClick: options.shiftClick ?? true,
        forceKeys: sendKeys && (options.forceKeys ?? options.forceTradeKeys ?? true),
        itemFilter: legacyItemFilter(options),
      },
      options.timeout,
    );
  }

  for (const name of LEGACY_MODES.slice(1)) {
    transferItems[name] = (options = {}) => transferItems(name, options);
  }
  // Shares the config with `bot.transfer`.
  Object.defineProperty(transferItems, 'config', { get: () => transfer.config, enumerable: true });
  transferItems.configure = transfer.configure;
  transferItems.resetConfig = transfer.resetConfig;

  bot.transfer = transfer;
  bot.transferItems = transferItems;
};

module.exports = inject;
