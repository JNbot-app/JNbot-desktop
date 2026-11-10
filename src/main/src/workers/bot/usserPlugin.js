/**********************************************

Plugin Made by usserwout

***********************************************/

const openWindow = require('./openWindow');
const itemInfo = require('./extensions/itemInfo');
const {
  parseItemText,
  parseRawNbt,
} = require('./extensions/nbtParser');
const { getOrAskPassword } = require('../lib/MissingDataHandler');
const { Vec3 } = require('vec3');
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
    const altData = workerScript.settings.altData[bot.username] ?? {}
    pass ??= altData.password;
    if(altData.premium && !pass) return
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
   *
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
