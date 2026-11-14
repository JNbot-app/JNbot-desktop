/**********************************************

Plugin Made by usserwout

***********************************************/

const openWindow = require('./openWindow');
const itemInfo = require('./extensions/itemInfo');
const { parseItemText, parseRawNbt } = require('./extensions/nbtParser');
const { getOrAskPassword } = require('../lib/MissingDataHandler');
const { Vec3 } = require('vec3');
// Plugin code runs in its own VM context, so its RegExps fail `instanceof RegExp`.
const { isRegExp } = require('util').types;
const {
  default: joinGamemode,
} = require('./statemachines/joinGamemode/joinGamemodeBehaviourV3');
const { default: workerScript } = require('../lib/workerScript');
const { installGamemodeApi } = require('./gamemode');
const alphabet = {
  ᴀ: 'a',
  ʙ: 'b',
  ᴄ: 'c',
  ᴅ: 'd',
  ᴇ: 'e',
  ғ: 'f',
  ꜰ: 'f',
  ɢ: 'g',
  ʜ: 'h',
  ɪ: 'i',
  ᴊ: 'j',
  ᴋ: 'k',
  ʟ: 'l',
  ᴍ: 'm',
  ɴ: 'n',
  ᴏ: 'o',
  ᴘ: 'p',
  ǫ: 'q',
  ʀ: 'r',
  ꜱ: 's',
  ᴛ: 't',
  ᴜ: 'u',
  ᴠ: 'v',
  ᴡ: 'w',
  z: 'z',
  x: 'x',
  ʏ: 'y',
};

String.prototype.toAlpha = function () {
  return this.replace(/./g, (c) => alphabet[c] || c);
};

const SMALL_CAPS = new RegExp(`[${Object.keys(alphabet).join('')}]`, 'g');
const COLOR_CODES = /§./g;
/** Strips color codes and maps small caps to plain letters (case kept). */
const stripText = (text) =>
  text.replace(COLOR_CODES, '').replace(SMALL_CAPS, (c) => alphabet[c]);
const cleanText = (text) => stripText(String(text ?? '')).toLowerCase();

// Cleaned name/lore per item; slot updates replace the Item object, so entries never go stale.
// The name falls back to the vanilla name when the item isn't renamed.
const itemTextCache = new WeakMap();
function itemText(item, field) {
  let entry = itemTextCache.get(item);
  if (!entry) itemTextCache.set(item, (entry = {}));
  return (entry[field] ??= stripText(
    itemInfo[field](item) || (field === 'name' && item.displayName) || '',
  ));
}

// string → case-insensitive substring; RegExp/function → tested on the color-stripped text;
// array → matches when any entry matches.
function textMatcher(pattern, caseSensitive) {
  if (pattern == null) return null;
  if (Array.isArray(pattern)) {
    const matchers = pattern.map((p) => textMatcher(p, caseSensitive));
    return (text) => matchers.some((match) => match(text));
  }
  if (isRegExp(pattern)) {
    return (text) => {
      pattern.lastIndex = 0; // `g`/`y` regexes keep state between tests
      return pattern.test(text);
    };
  }
  if (typeof pattern === 'function') return pattern;
  if (caseSensitive) {
    const needle = stripText(String(pattern));
    return (text) => text.includes(needle);
  }
  const needle = cleanText(pattern);
  return (text) => text.toLowerCase().includes(needle);
}

const range = (start, end) =>
  Array.from({ length: Math.max(end - start, 0) }, (_, i) => start + i);

/** Chainable, lazy item search over the open window and/or the player inventory. See `bot.items`. */
class ItemQuery {
  constructor(bot, query = {}) {
    if (
      typeof query === 'string' ||
      isRegExp(query) ||
      Array.isArray(query)
    )
      query = { name: query };
    else if (typeof query === 'function') query = { where: query };
    const types = query.type == null ? null : new Set([].concat(query.type));
    this._bot = bot;
    this._name = textMatcher(query.name, query.caseSensitive);
    this._lore = textMatcher(query.lore, query.caseSensitive);
    this._type = types && ((item) => types.has(item.name));
    this._where = query.where;
    this._scope = 'any';
  }

  /** Container first, then the player inventory (default). */
  any() {
    this._scope = 'any';
    return this;
  }
  /** Only the top part of the open window; nothing when no window is open. */
  container() {
    this._scope = 'container';
    return this;
  }
  /** Only the player inventory (main + hotbar), whether or not a window is open. */
  inventory() {
    this._scope = 'inventory';
    return this;
  }
  /** Only the 9 hotbar slots. */
  hotbar() {
    this._scope = 'hotbar';
    return this;
  }
  /** Container rows (9 slots each, 0-based). Combined with `cols` it keeps their intersection. */
  rows(...rows) {
    this._rows = new Set(rows.flat());
    this._scope = 'container';
    return this;
  }
  /** Container columns (0-8). */
  cols(...cols) {
    this._cols = new Set(cols.flat());
    this._scope = 'container';
    return this;
  }
  /** Exact window slot indexes. */
  slots(...slots) {
    this._slots = slots.flat();
    return this;
  }

  _indexes() {
    if (this._slots) return this._slots;
    const window = this._bot.currentWindow;
    const inv = window ?? this._bot.inventory;
    if (!inv) return [];
    const container = range(0, window ? window.inventoryStart : 0).filter(
      (i) =>
        (!this._rows || this._rows.has(Math.floor(i / 9))) &&
        (!this._cols || this._cols.has(i % 9)),
    );
    const inventory = range(inv.inventoryStart, inv.inventoryEnd);
    switch (this._scope) {
      case 'container':
        return container;
      case 'inventory':
        return inventory;
      case 'hotbar':
        return range(inv.inventoryEnd - 9, inv.inventoryEnd);
      default:
        return container.concat(inventory);
    }
  }

  /** Whether `item` passes the name/lore/type/where filters (scope is ignored). */
  matches(item) {
    return (
      !!item &&
      (!this._type || this._type(item)) &&
      (!this._name || this._name(itemText(item, 'name'))) &&
      (!this._lore || this._lore(itemText(item, 'lore'))) &&
      (!this._where || this._where(item))
    );
  }

  *[Symbol.iterator]() {
    const slots = (this._bot.currentWindow ?? this._bot.inventory)?.slots;
    if (!slots) return;
    for (const i of this._indexes()) {
      const item = slots[i];
      if (this.matches(item)) yield item;
    }
  }

  /** First matching item, or null. */
  first() {
    for (const item of this) return item;
    return null;
  }

  /** All matching items. */
  all() {
    return [...this];
  }

  /** Whether any item matches. */
  has() {
    return this.first() !== null;
  }

  /** Total stack count of all matching items. */
  count() {
    let total = 0;
    for (const item of this) total += item.count;
    return total;
  }

  /** Clicks the first match; returns it, or null when nothing matched. */
  async click(button = 0, mode = 0) {
    const item = this.first();
    if (item) await this._bot.clickWindow(item.slot, button, mode);
    return item;
  }

  /** Transfers the matching inventory items; see `bot.transfer`. */
  transfer(mode, target, options) {
    if (target && typeof target === 'object') [target, options] = [undefined, target];
    return this._bot.transfer(mode, target, { ...options, items: this });
  }

  /** Resolves with the first match as soon as one appears, or null after `ticks`. */
  wait(ticks = 100) {
    const bot = this._bot;
    return new Promise((resolve) => {
      let window = null;
      let done = false;
      const check = () => {
        const item = this.first();
        if (item) finish(item);
      };
      const bind = () => {
        window?.removeListener('updateSlot', check);
        window = bot.currentWindow;
        window?.on('updateSlot', check);
        check();
      };
      const finish = (item) => {
        done = true;
        window?.removeListener('updateSlot', check);
        bot.inventory?.removeListener('updateSlot', check);
        bot.removeListener('windowOpen', bind);
        resolve(item ?? null);
      };
      bot.inventory?.on('updateSlot', check);
      bot.on('windowOpen', bind);
      bot.waitForTicks(ticks).then(() => !done && finish(this.first()));
      bind();
    });
  }
}
const ignoreBlocks = ['barrier', 'grass', 'tall_grass'];

const inject = (bot) => {
  const mc = bot.registry;
  const ignoreBlocksIds = new Set();
  for (let block of ignoreBlocks) {
    const blockData = mc.blocksByName[block];
    if (blockData) ignoreBlocksIds.add(blockData.id);
  }

  installGamemodeApi(bot);

  bot.__login = async (pass) => {
    const altData = workerScript.settings.altData[bot.username] ?? {};
    pass ??= altData.password;
    if (altData.premium && !pass) return;
    if (!pass) {
      pass = await getOrAskPassword(bot.username);
      // Check if bot is still online..
      if (!bot.isOnline?.()) {
        return;
      }
    }

    if (!pass)
      throw new Error(
        'No password found. Please add ' +
          (bot.username || 'your alt') +
          ' to your alt list.',
      );

    bot.chat('/login ' + pass);
  };

  bot.login = (pass) => {
    return new Promise((resolve) => {
      bot.once('login', async () => {
        await bot.waitForTicks(5);
        await bot.__login(pass);
        resolve();
      });
    });
  };
  bot.loadPlugin(openWindow);

  bot.getWindowTitle = (win = bot.currentWindow) => {
    if (win == null) return null;
    if (typeof win.title === 'string') {
      if (win.title.startsWith('{')) {
        try {
          const parsed = JSON.parse(win.title);
          if (parsed.extra) {
            return parseItemText(parsed);
          }
        } catch (e) {}
      }

      return win.title;
    }
    if (typeof win.title === 'object') {
      return parseRawNbt(win.title);
    }
    return '';
  };

  bot.isOnline = () =>
    bot.session?.bot && bot.session.bot !== bot
      ? bot.session.bot.isOnline()
      : bot._client?.ended === false;
  bot.mainVersion = Number(bot.version.split('.')[1]);
  bot.itemInfo = itemInfo;

  bot.hasFullInventory = () => {
    let inv = bot?.inventory?.slots;
    if (!inv) return false;
    for (
      let i = bot.inventory.inventoryStart;
      i < bot.inventory.inventoryEnd;
      i++
    ) {
      if (inv[i] == null) {
        return false;
      }
    }
    return true;
  };

  bot.countInventoryItems = () => {
    let inv = bot?.inventory?.slots;
    if (!inv) return 0;
    let itemCounter = 0;
    for (
      let i = bot.inventory.inventoryStart;
      i < bot.inventory.inventoryEnd;
      i++
    ) {
      let slot = inv[i];
      if (slot && slot?.name !== 'clock') itemCounter++;
    }
    return itemCounter;
  };

  bot.join = (gamemode, options) =>
    bot.session?.bot && bot.session.bot !== bot
      ? bot.session.bot.join(gamemode, options)
      : joinGamemode(bot, gamemode, options);

  // The inventory-open client command was removed in Minecraft 1.12.
  bot.openInventory = () => {
    if (bot.registry.version['>=']('1.12')) return;
    bot._client.write('client_command', {
      payload: 2,
    });
  };

  bot.closeInventory = () => {
    if (bot.currentWindow) return;
    bot._client.write('close_window', {
      windowId: 0,
    });
  };

  bot.onceWithTimeout = (event, timeoutInTicks) => {
    return new Promise((resolve) => {
      function cleanup(...e) {
        bot.removeListener(event, cleanup);
        resolve(...e);
      }

      bot.waitForTicks(timeoutInTicks).then(cleanup);
      bot.once(event, cleanup);
    });
  };

  /**
   * Item search over the open window and/or inventory; see ItemQuery.
   * @param {string | RegExp | Function | {name?, lore?, type?, where?, caseSensitive?}} [query]
   * @returns {ItemQuery}
   */
  bot.items = (query) => new ItemQuery(bot, query);
  bot.cleanText = cleanText;

  /**
   * @deprecated Use `bot.items(query)` instead.
   * @param {{name?:string, lore?:string} | string} filter
   * @param {{caseSensitive?:boolean, rows?: number[], columns?: number[], slotRange?: number[], window: Inventory }} options
   * Assume 1 row is 9 slots, the window are the slots between
   * @returns {Array<Slot>}
   */
  bot.findWindowSlots = (
    filter,
    options = {
      caseSensitive: false,
      rows: null,
      columns: null,
      slotRange: null,
      window: null,
      toAlpha: false,
    },
  ) => {
    if (typeof filter === 'string') {
      filter = { name: filter };
    }

    const window = options.window || bot.currentWindow;
    if (!window) return [];

    const items = [];
    let slotsToSearch;
    // Pre-process filter values once
    const filterName = filter.name
      ? options.caseSensitive
        ? filter.name
        : filter.name?.toLowerCase()
      : null;
    const filterLore = filter.lore
      ? options.caseSensitive
        ? filter.lore
        : filter.lore?.toLowerCase()
      : null;

    // Determine which slots to search based on options
    if (options.slotRange) {
      slotsToSearch = options.slotRange;
    } else if (options.rows || options.columns) {
      const slotSet = new Set();

      if (options.rows) {
        for (const row of options.rows) {
          const startSlot = row * 9;
          const endSlot = Math.min(startSlot + 9, window.inventoryStart);
          for (let i = startSlot; i < endSlot; i++) {
            slotSet.add(i);
          }
        }
      }

      if (options.columns) {
        const maxRows = Math.ceil(window.inventoryStart / 9);
        for (const col of options.columns) {
          if (col < 9) {
            for (let row = 0; row < maxRows; row++) {
              const slotIndex = row * 9 + col;
              if (slotIndex < window.inventoryStart) {
                slotSet.add(slotIndex);
              }
            }
          }
        }
      }

      slotsToSearch = Array.from(slotSet);
    } else {
      slotsToSearch = Array.from(
        { length: window.inventoryStart },
        (_, i) => i,
      );
    }

    for (const slotIndex of slotsToSearch) {
      const slot = window.slots[slotIndex];
      if (!slot) continue;

      const itemInfo = bot.itemInfo(slot);

      let itemName = options.caseSensitive
        ? itemInfo.name
        : itemInfo.name.toLowerCase();
      itemName = options.toAlpha ? itemName.toAlpha() : itemName;
      if (filterName && !itemName.includes(filterName)) continue;
      let itemLore = options.caseSensitive
        ? itemInfo.info
        : itemInfo.info.toLowerCase();
      itemLore = options.toAlpha ? itemLore.toAlpha() : itemLore;

      if (filterLore && !itemLore.includes(filterLore)) continue;

      items.push(slot);
    }

    return items;
  };

  bot.dumpChunk = (chunk) => {
    const blocks = Array.from(new Uint16Array(16 * 16));
    let index = 0;
    const minY = chunk.minY ?? 0;
    const maxY = minY + (chunk.worldHeight ?? 256) - 1;

    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let blockId = 0;
        let blockY = 0;
        for (let y = maxY; y >= minY; y--) {
          const id = chunk.getBlockType(new Vec3(x, y, z));
          if (id !== 0) {
            if (ignoreBlocksIds.has(id)) continue;
            blockId = id;
            blockY = y;
            break;
          }
        }

        const slot = index >> 1;
        const heightSlot = 128 + slot;
        const packedY = blockY & 0xffff;
        if (index & 1) {
          blocks[slot] |= blockId;
          blocks[heightSlot] |= packedY;
        } else {
          blocks[slot] = blockId << 16;
          blocks[heightSlot] = packedY << 16;
        }
        index++;
      }
    }
    return blocks;
  };

  bot.dumpChunkWithPos = (chunk, pos) => {
    const blocks = Array.from(new Uint16Array(16 * 16));
    let index = 0;
    const minY = chunk.minY ?? 0;
    const maxY = minY + (chunk.worldHeight ?? 256) - 1;
    const startY = Math.max(minY, Math.min(maxY, pos.y));

    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let blockId = 0;
        let blockY = 0;
        const blockType = chunk.getBlockType(new Vec3(x, startY, z));

        if (blockType !== 0 && !ignoreBlocksIds.has(blockType)) {
          let currentType = blockType;
          let currentY = startY;
          for (let y = startY + 1; y <= maxY; y++) {
            const id = chunk.getBlockType(new Vec3(x, y, z));
            if (id === 0 || ignoreBlocksIds.has(id)) {
              break;
            }
            currentType = id;
            currentY = y;
          }
          blockId = currentType;
          blockY = currentY;
        } else {
          for (let y = startY; y >= minY; y--) {
            const id = chunk.getBlockType(new Vec3(x, y, z));
            if (id !== 0) {
              if (ignoreBlocksIds.has(id)) continue;
              blockId = id;
              blockY = y;
              break;
            }
          }
        }

        const slot = index >> 1;
        const heightSlot = 128 + slot;
        const packedY = blockY & 0xffff;
        if (index & 1) {
          blocks[slot] |= blockId;
          blocks[heightSlot] |= packedY;
        } else {
          blocks[slot] = blockId << 16;
          blocks[heightSlot] = packedY << 16;
        }
        index++;
      }
    }
    return blocks;
  };

  bot.waitForTicks = async function (ticks) {
    if (ticks <= 0) return;
    await new Promise((resolve) => {
      // Assuming 20 ticks per second, add extra time for lag
      const timeout = setTimeout(
        () => {
          bot.removeListener('physicsTick', tickListener);
          resolve();
        },
        ticks * 60 + 5000,
      ); // 50ms per tick + 5s buffer

      const tickListener = () => {
        ticks--;
        if (ticks === 0) {
          clearTimeout(timeout);
          bot.removeListener('physicsTick', tickListener);
          resolve();
        }
      };

      bot.on('physicsTick', tickListener);
    });
  };
};

module.exports = inject;
module.exports.ItemQuery = ItemQuery;
