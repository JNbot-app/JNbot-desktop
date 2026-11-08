const { GoalNear, GoalNearXZ } = require('mineflayer-pathfinder').goals;
const addPathFinder = require('./pathFinderPlugin');
const axios = require('axios');
const scriptActionRunner = require('../compiler/scriptActions');
const { workerData } = require('worker_threads');
const { getItemText, toAnsi } = require('./extensions/nbtParser');
const { toChatLine } = require('./extensions/chatParts');
const runJsBotCode = require('./extensions/runBotCode');
const Vec3 = require('vec3').Vec3;
const workerScript = require('../lib/workerScript').default;
const {
  startBotAutomation,
  controlBotAutomation,
  stopBotAutomation,
} = require('./automation');
const { getRecipeActionHandler } = require('./plugin/RecipeActions');
const mapEntities = require('./mapEntities');
const { attachTriggers } = require('./triggers');
const { attachScreenPrompts } = require('./screenPrompts');
const { compileTriggerFilter } = require('../../../../common/triggers');

const inject = (bot) => {
  const triggers = attachTriggers(bot);
  const disposeTerminate = workerScript.onceMessage('TERMINATE', terminate);

  function terminate() {
    bot?.end?.();
  }

  let messages = [];
  let chatEntries = [];
  let chatCursor = 0;

  // Recent lifecycle events (kicks, deaths, ...) so AI clients can see why
  // something went wrong. Shares the cursor counter with chat entries.
  const eventEntries = [];
  const eventHandlers = {
    spawn: () => recordEvent('spawn'),
    death: () => recordEvent('death'),
    kicked: (reason) => recordEvent('kicked', { reason: toChatLine(reason).message }),
    end: (reason) => recordEvent('disconnect', { reason: String(reason ?? '') }),
    error: (error) => recordEvent('error', { message: String(error?.message ?? error) }),
    windowOpen: () => recordEvent('window', { title: bot.getWindowTitle?.() ?? null }),
    gamemodeChanged: () => recordEvent('gamemode', { gamemode: bot.getGamemode?.() ?? null }),
  };
  function recordEvent(type, data) {
    eventEntries.push({ cursor: String(++chatCursor), timestamp: Date.now(), type, ...data });
    if (eventEntries.length > 100) eventEntries.shift();
  }
  for (const [event, handler] of Object.entries(eventHandlers)) bot.on(event, handler);

  let isPathfinding = false;
  let mapWindowGeneration = 0;
  let mapWindowCenter = null;
  let mapWindowDistance = null;
  const publishedMapChunks = new Set();
  let UID;
  let sendData = {
    chat: [],
    map: [] /* ({type:"load", x: number, z: number, chunk: Buffer(16*16*2)} | {type: "unload", x:number, z:number} | {type: "unload-all"})[] */,
  };
  let update = {
    chat: false,
    info: false,
    inventory: false,
    hotbar: false,
    movement: false,
  };
  // -------------------- Functions ------------------ \\

  bot.on('chunkColumnLoad', onChunkLoad);
  bot.on('chunkColumnUnload', onChunkUnload);
  bot.on('game', resetMapWindow);
  bot.on('game', clearSelectedItem);
  bot.on('gamemodeChanged', clearSelectedItem);
  const disposeChunkSubscription = bot.messenger?.onSubscription(
    'chunks',
    reconcileMapWindow,
  );
  let entityTimer = null;
  let lastEntitySnapshot = '';
  let lastEntities = [];
  function publishMapEntities() {
    if (!bot.messenger?.hasSubscribers('map-entities')) return;
    const entities = mapEntities(bot);
    const snapshot = JSON.stringify(entities);
    if (snapshot !== lastEntitySnapshot) {
      lastEntitySnapshot = snapshot;
      lastEntities = entities;
      bot.messenger.publish('map-entities', entities);
    }
  }
  const disposeEntitySubscription = bot.messenger?.onSubscription('map-entities', () => {
    lastEntitySnapshot = '';
    publishMapEntities();
    entityTimer = setInterval(publishMapEntities, 500);
  });
  const disposeAdditionalEntitySubscription = bot.messenger?.onAdditionalSubscription('map-entities', (address) => {
    bot.messenger.publishTo('map-entities', address, lastEntities);
  });
  const disposeEntityUnsubscription = bot.messenger?.onUnsubscription('map-entities', () => {
    clearInterval(entityTimer);
    entityTimer = null;
    lastEntitySnapshot = '';
    lastEntities = [];
  });

  // A window arrives as a burst of slot updates (a /kit menu is ~300), so
  // publish one snapshot per burst; one per slot stalls the bot for 100+ ms.
  let inventoryPublish = null;
  function publishInventory() {
    if (inventoryPublish || !bot.messenger?.hasSubscribers('inventory')) return;
    inventoryPublish = setImmediate(() => {
      inventoryPublish = null;
      if (bot.messenger?.hasSubscribers('inventory'))
        bot.messenger.publish('inventory', createInventoryPacket());
    });
  }

  const prompts = attachScreenPrompts(bot, publishInventory);
  bot.on('windowOpen', (window) => {
    window.on('updateSlot', publishInventory);
    publishInventory();
  });
  bot.on('windowClose', (window) => {
    if (window) window.selectedItem = null;
    bot.inventory.selectedItem = null;
    publishInventory();
  });
  bot.inventory.on('updateSlot', publishInventory);

  bot.on('message', chatHandler);
  bot.on('move', moveHandler);
  bot.on('forcedMove', forceMoveHandler);

  async function getUID() {
    if (UID !== undefined) return UID;
    try {
      const response = await axios.get(
        'https://api.mojang.com/users/profiles/minecraft/' + bot.username,
      );
      if (response.status !== 200) {
        UID = null;
        return null;
      }

      UID = response.data.id;
      return UID;
    } catch {
      UID = null;
      return null;
    }
  }

  function onChunkLoad(chunkColumn) {
    if (!bot.messenger?.hasSubscribers('chunks')) return;
    const x = Math.floor(chunkColumn.x / 16);
    const z = Math.floor(chunkColumn.z / 16);
    if (!isInMapWindow(x, z)) return;
    publishMapChunk(x, z);
  }

  function onChunkUnload(chunkColumn) {
    if (!bot.messenger?.hasSubscribers('chunks')) return;
    const x = Math.floor(chunkColumn.x / 16);
    const z = Math.floor(chunkColumn.z / 16);
    const key = mapChunkKey(x, z);
    if (!publishedMapChunks.delete(key)) return;
    bot.messenger?.publish('chunks', {
      type: 'unload',
      x,
      z,
    });
  }

  function mapRenderDistance() {
    const distance = Number(global.appSettings?.render_distance);
    if (Number.isFinite(distance) && distance >= 0) return Math.floor(distance);
    return global.isMobileRuntime || workerData?.isMobileRuntime ? 2 : 12;
  }

  function currentMapCenter() {
    const position = bot.entity?.position;
    if (!position) return null;
    return { x: Math.floor(position.x / 16), z: Math.floor(position.z / 16) };
  }

  function mapChunkKey(x, z) {
    return `${x},${z}`;
  }

  function isInMapWindow(x, z, center = currentMapCenter()) {
    if (!center) return false;
    const distance = mapRenderDistance();
    return (
      Math.abs(x - center.x) <= distance && Math.abs(z - center.z) <= distance
    );
  }

  function publishMapChunk(x, z) {
    const key = mapChunkKey(x, z);
    if (publishedMapChunks.has(key)) return;
    const column = bot.world.async.getLoadedColumn(x, z);
    if (!column) return;
    publishedMapChunks.add(key);
    bot.messenger?.publish('chunks', {
      type: 'load',
      x,
      z,
      chunk: bot.dumpChunkWithPos(column, bot.entity.position.floored()),
    });
  }

  function reconcileMapWindow() {
    if (!bot.messenger?.hasSubscribers('chunks')) return;
    const center = currentMapCenter();
    if (!center) return;
    const generation = ++mapWindowGeneration;
    mapWindowCenter = center;
    mapWindowDistance = mapRenderDistance();

    for (const key of [...publishedMapChunks]) {
      const [x, z] = key.split(',').map(Number);
      if (isInMapWindow(x, z, center)) continue;
      publishedMapChunks.delete(key);
      bot.messenger?.publish('chunks', { type: 'unload', x, z });
    }

    const pending = [];
    for (const entry of bot.world.async.getColumns()) {
      const x = Number(entry.chunkX);
      const z = Number(entry.chunkZ);
      if (isInMapWindow(x, z, center)) pending.push([x, z]);
    }
    let index = 0;
    const publishNext = () => {
      if (
        generation !== mapWindowGeneration ||
        !bot.messenger?.hasSubscribers('chunks')
      )
        return;
      const next = pending[index++];
      if (!next) return;
      publishMapChunk(next[0], next[1]);
      setImmediate(publishNext);
    };
    publishNext();
  }

  function resetMapWindow() {
    mapWindowGeneration += 1;
    for (const key of publishedMapChunks) {
      const [x, z] = key.split(',').map(Number);
      bot.messenger?.publish('chunks', { type: 'unload', x, z });
    }
    publishedMapChunks.clear();
    mapWindowCenter = null;
    mapWindowDistance = null;
    setImmediate(reconcileMapWindow);
  }

  function startPathFinder({ x, y, z }) {
    const toggle = (b = false) => {
      if (isPathfinding !== b) {
        isPathfinding = b;
        update.movement = true;
      }
    };
    console.log('Pathfinding to', x, z, isPathfinding);
    if (isPathfinding) {
      bot.pathfinder.stop();
      bot.pathfinder.setGoal(null);
      toggle(false);
      return;
    }
    if (typeof x !== 'number' || typeof z !== 'number')
      return console.log('Invalid ', x, y, z);
    addPathFinder(bot);

    try {
      if (typeof y === 'number') {
        bot.pathfinder
          .goto(new GoalNear(x, y, z, 1), true)
          .catch(console.log)
          .finally(() => toggle(false));
      } else {
        bot.pathfinder
          .goto(new GoalNearXZ(x, z, 0.1), true)
          .catch(console.log)
          .finally(() => {
            console.log('FInished pathfinding to', x, z);
            toggle(false);
          });
      }
      toggle(true);
    } catch (err) {
      console.log(err);
    }
  }
  const chatMessage = (msg) => {
    bot.chat(msg);
  };

  function toggleMovement(movement) {
    if (movement === 'fly') {
      if (bot.isFlying) bot.creative.stopFlying();
      else bot.creative.startFlying();
      bot.isFlying = !bot.isFlying;
    } else bot.setControlState(movement, !bot.getControlState(movement));

    movementPacket();
  }
  function stopMovement() {
    bot.clearControlStates();
    movementPacket();
  }
  const joinGamemode = async (gm) => {
    return bot.join(gm);
  };
  async function tossItems(count = 1) {
    if (count === undefined) count = 1;
    const inventory = bot.currentWindow ?? bot.inventory;
    const item = inventory.slots[inventory.hotbarStart + bot.quickBarSlot];
    if (!item) return;
    for await (let _ of new Array(Math.min(item.count, count)).fill(0)) {
      bot.clickWindow(item.slot, 0, 4);
      await bot.waitForTicks(2);
    }
  }

  function leave() {
    bot?.end?.();
  }

  function respawn() {
    bot?.respawn?.();
  }

  async function activateItem() {
    bot.activateItem();
    await bot.waitForTicks(2);
    bot.deactivateItem();
  }

  // data: { button: 'left' | 'right', mode: 'click' | 'press' | 'release' }; returns which buttons are held
  function mouse({ button, mode } = {}) {
    if (button) {
      if (!['click', 'press', 'release'].includes(mode)) throw new Error(`Unknown mouse mode "${mode}"`);
      bot.mouse[mode](button);
    }
    return { left: bot.mouse.isDown('left'), right: bot.mouse.isDown('right') };
  }
  async function login() {
    await bot.__login();
  }

  async function inventoryClick(data) {
    if (!bot.currentWindow) {
      bot.openInventory();
    }
    await bot.clickWindow(data.slot, data.button ?? 0, data.mode ?? 0);
    publishInventory();
    if (
      !bot.currentWindow &&
      !bot.inventory.selectedItem &&
      !bot.inventory.slots.slice(1, 5).some(Boolean)
    ) {
      bot.closeInventory();
    }
  }
  let itemNameChannel = false;
  /** Anvil rename field; vanilla sends it on every keystroke. */
  function renameItem(name) {
    name = String(name ?? '');
    if (!bot.supportFeature('useMCItemName')) return bot._client.write('name_item', { name });
    if (!itemNameChannel) bot._client.registerChannel('MC|ItemName', 'string');
    itemNameChannel = true;
    bot._client.writeChannel('MC|ItemName', name);
  }
  function closeWindow() {
    // Vanilla submits the sign's current text when its editor is closed
    if (prompts.getPrompt()) return prompts.closePrompt();
    if (bot?.currentWindow) {
      bot.closeWindow(bot.currentWindow);
    } else {
      bot?.closeInventory();
      clearSelectedItem();
    }
  }
  async function setHotbar(data) {
    if (!bot?.username || isNaN(data)) return;
    bot.setQuickBarSlot(data - 1);
  }

  function clearSelectedItem() {
    if (!bot.inventory.selectedItem && !bot.currentWindow?.selectedItem) return;
    bot.inventory.selectedItem = null;
    if (bot.currentWindow) bot.currentWindow.selectedItem = null;
    publishInventory();
  }
  async function setHeadRotation({ yaw, pitch }) {
    await bot.look(yaw, pitch);
    movementPacket();
  }
  async function eat() {
    try {
      await bot.consume();
    } catch {}
  }
  async function tabComplete(str) {
    try {
      const complete = await bot.tabComplete(str);
      return complete;
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  async function runScriptAction({ id, arg, optionOverrides }) {
    try {
      await scriptActionRunner({ id, bot, args: arg, optionOverrides });
    } catch (err) {
      console.log(err);
    }
  }

  async function mcpRunPluginAction({ id, arg, optionOverrides }) {
    return scriptActionRunner({
      id,
      bot,
      args: arg,
      optionOverrides,
    });
  }

  function chatHandler(message, position) {
    if (position === 'game_info') return;
    const line = toChatLine(message);
    messages.push(line.parts ? line : line.message);
    chatEntries.push({
      cursor: String(++chatCursor),
      timestamp: Date.now(),
      message: line.message,
    });
    if (messages.length > 20) {
      messages.shift();
    }
    if (chatEntries.length > 200) chatEntries.shift();
    bot.messenger?.publish('chat', line);
  }

  let lastMovementPos = null;
  function forceMoveHandler(pos) {
    const position = pos || bot.entity?.position;
    if (!position) return;
    lastMovementPos = position.clone ? position.clone() : position;
    const coords = position.toArray
      ? position.toArray()
      : [position.x, position.y, position.z];
    bot.messenger?.publish('movement', coords);

    resetMapWindow();
  }
  function moveHandler() {
    if (!bot.entity?.position) return;
    const currPos = bot.entity.position;
    if (!lastMovementPos || !lastMovementPos.equals(currPos)) {
      lastMovementPos = currPos.clone();
      const coords = currPos.toArray();
      bot.messenger?.publish('movement', coords);
    }
    const center = currentMapCenter();
    if (
      center &&
      (!mapWindowCenter ||
        center.x !== mapWindowCenter.x ||
        center.z !== mapWindowCenter.z ||
        mapWindowDistance !== mapRenderDistance())
    ) {
      reconcileMapWindow();
    }
  }

  // -------------------- Packages ------------------ \\

  function movementPacket() {
    const payload = currentMovement();
    lastPublishedMovement = payload;
    lastMovementPublish = Date.now();
    bot.messenger?.publish('movement-state', payload);
  }

  function currentMovement() {
    return {
      forward: bot.getControlState('forward'),
      back: bot.getControlState('back'),
      left: bot.getControlState('left'),
      right: bot.getControlState('right'),
      jump: bot.getControlState('jump'),
      sprint: bot.getControlState('sprint'),
      sneak: bot.getControlState('sneak'),
      fly: bot.isFlying,
      isPathfinding,
      yaw: bot.entity.yaw,
      pitch: bot.entity.pitch,
    };
  }

  let lastPublishedMovement = null;
  let lastMovementPublish = 0;
  function publishMovementChange() {
    if (!bot.messenger?.hasSubscribers('movement-state')) return;
    const current = currentMovement();
    const previous = lastPublishedMovement;
    if (
      previous &&
      Math.abs(current.yaw - previous.yaw) < 0.01 &&
      Math.abs(current.pitch - previous.pitch) < 0.01 &&
      current.forward === previous.forward &&
      current.back === previous.back &&
      current.left === previous.left &&
      current.right === previous.right &&
      current.jump === previous.jump &&
      current.sprint === previous.sprint &&
      current.sneak === previous.sneak &&
      current.fly === previous.fly &&
      current.isPathfinding === previous.isPathfinding
    ) return;
    if (Date.now() - lastMovementPublish >= 100) movementPacket();
  }

  getUID();
  function infoPacket() {
    const payload = {
      username: bot.username,
      position: bot.entity?.position.floored() ?? { x: 0, y: 0, z: 0 },
      gamemode: bot.currentGamemode,
      hunger: bot.food,
      health: bot.health,
      xp: bot.experience?.points,
      level: bot.experience?.level,
      xpProgress: bot.experience?.progress,
      uuid: UID ?? bot.player?.uuid,
      ping: bot.player?.ping ?? 0,
    };
    bot.messenger?.publish('info', payload);
  }
  function chatPacket() {
    const payload = { messages };
    bot.messenger?.publish('chat', payload);
  }

  function createItemSlotPacket(slot, slotId) {
    if (!slot) return null;
    const display = getItemText(slot);

    return {
      display: {
        name: toAnsi(display.name),
        lore: toAnsi(display.lore),
      },
      name: slot.name,
      count: slot.count,
      displayName: slot.displayName,
      slot: Number.isInteger(slot.slot) ? slot.slot : slotId,
    };
  }

  function createInventoryPacket() {
    const window = bot.currentWindow ?? bot.inventory;
    if (!window) return;

    return {
      items: window.slots.map(createItemSlotPacket),
      isInventory: window.type === 'minecraft:inventory',
      title: toAnsi(bot.getWindowTitle()),
      inventoryStart: window.inventoryStart,
      selected: bot.quickBarSlot,
      selectedItem: createItemSlotPacket(window.selectedItem),
      type: window.type,
      prompt: prompts.getPrompt(),
      map: prompts.getMap(),
    };
  }

  function sendInventoryPacket() {
    if (!bot?.username) {
      console.log('Bot not ready');
      return { items: [] };
    }
    const data = createInventoryPacket();
    bot.messenger?.publish('inventory', data);
    return data;
  }

  function mcpGetState() {
    const position = bot.entity?.position;
    return {
      username: bot.username,
      connected: Boolean(bot.username && bot.entity),
      health: bot.health ?? null,
      food: bot.food ?? null,
      oxygen: bot.oxygenLevel ?? null,
      position: position
        ? { x: position.x, y: position.y, z: position.z }
        : null,
      yaw: bot.entity?.yaw ?? null,
      pitch: bot.entity?.pitch ?? null,
      gamemode: bot.getGamemode?.() ?? bot.currentGamemode ?? null,
      selectedSlot: (bot.quickBarSlot ?? 0) + 1,
      heldItem: createItemSlotPacket(bot.heldItem, bot.heldItem?.slot),
      windowOpen: Boolean(bot.currentWindow),
    };
  }

  /** Live values the plugin editor can insert into code. */
  function editorContext() {
    const win = bot.currentWindow;
    const position = bot.entity?.position?.floored();
    return {
      position: position ? { x: position.x, y: position.y, z: position.z } : null,
      yaw: bot.entity?.yaw ?? null,
      pitch: bot.entity?.pitch ?? null,
      heldItem: bot.heldItem?.name ?? null,
      lookingAt: serializeBlock(bot.blockAtCursor?.(6)),
      window: win
        ? {
            title: bot.getWindowTitle(win),
            items: win.slots
              .slice(0, win.inventoryStart)
              .filter(Boolean)
              .map(({ slot, name, displayName, count }) => ({
                slot,
                name,
                displayName,
                count,
              })),
          }
        : null,
    };
  }

  function mcpGetChat({ cursor, limit } = {}) {
    const cappedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const start = cursor
      ? Math.max(
          0,
          chatEntries.findIndex((entry) => entry.cursor === cursor) + 1,
        )
      : Math.max(0, chatEntries.length - cappedLimit);
    const entries = chatEntries.slice(start, start + cappedLimit);
    return {
      entries,
      nextCursor: entries.at(-1)?.cursor ?? cursor ?? null,
      hasMore: start + entries.length < chatEntries.length,
    };
  }

  function mcpGetInventory() {
    const packet = createInventoryPacket() ?? { items: [] };
    return {
      ...packet,
      items: packet.items.map((item, slot) =>
        item ? { ...item, slot: item.slot ?? slot } : null,
      ),
    };
  }

  function mcpGetPlayers() {
    const entries = Object.values(bot.players ?? {})
      .filter((player) => player?.username)
      .map((player) => ({
        username: player.username,
        ping: Number.isFinite(player.ping) ? player.ping : null,
        gamemode: Number.isFinite(player.gamemode) ? player.gamemode : null,
      }))
      .sort((left, right) => left.username.localeCompare(right.username));
    const limit = 100;
    return {
      entries: entries.slice(0, limit),
      total: entries.length,
      truncated: entries.length > limit,
    };
  }

  function mcpGetNearbyEntities({ maxDistance, limit } = {}) {
    const distance = Math.min(64, Math.max(1, Number(maxDistance) || 32));
    const cappedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const origin = bot.entity?.position;
    if (!origin) return [];
    return Object.values(bot.entities ?? {})
      .filter((entity) => entity !== bot.entity && entity.position)
      .map((entity) => ({
        id: entity.id,
        type: entity.type,
        name:
          entity.username ??
          entity.displayName ??
          entity.name ??
          entity.mobType ??
          '',
        position: {
          x: entity.position.x,
          y: entity.position.y,
          z: entity.position.z,
        },
        distance: entity.position.distanceTo(origin),
      }))
      .filter((entity) => entity.distance <= distance)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, cappedLimit);
  }

  function serializeBlock(block) {
    if (!block) return null;
    return {
      name: block.name,
      displayName: block.displayName,
      type: block.type,
      metadata: block.metadata,
      position: {
        x: block.position.x,
        y: block.position.y,
        z: block.position.z,
      },
    };
  }

  function mcpGetBlockAt({ x, y, z }) {
    const position = new Vec3(Number(x), Number(y), Number(z));
    if (![position.x, position.y, position.z].every(Number.isFinite))
      throw new Error('Block coordinates must be finite numbers.');
    if (bot.entity?.position?.distanceTo(position) > 64)
      throw new Error('Block lookup is limited to 64 blocks from the bot.');
    return serializeBlock(bot.blockAt(position));
  }

  function mcpFindBlocks({ name, maxDistance, limit } = {}) {
    const wanted = String(name ?? '')
      .replace(/^minecraft:/, '')
      .toLowerCase();
    const block = bot.registry?.blocksByName?.[wanted];
    if (!block) return [];
    const positions = bot.findBlocks({
      matching: block.id,
      maxDistance: Math.min(64, Math.max(1, Number(maxDistance) || 32)),
      count: Math.min(100, Math.max(1, Number(limit) || 25)),
    });
    return positions.map((position) => serializeBlock(bot.blockAt(position)));
  }

  function mcpGetEvents({ cursor } = {}) {
    const start = cursor
      ? eventEntries.findIndex((entry) => Number(entry.cursor) > Number(cursor))
      : 0;
    return start < 0 ? [] : eventEntries.slice(start);
  }

  /**
   * Resolve on the next matching event, or `{ timedOut: true }`. `match`
   * filters chat messages and kick/disconnect reasons: text or `/regex/i`.
   */
  function mcpWaitForEvent({ event, match, timeoutMs } = {}) {
    const timeout = Math.min(25_000, Math.max(1, Number(timeoutMs) || 25_000));
    const eventMap = {
      chat: 'messagestr',
      window: 'windowOpen',
      inventory: 'updateSlot',
      gamemode: 'gamemodeChanged',
      health: 'health',
      death: 'death',
      spawn: 'spawn',
      kicked: 'kicked',
      disconnect: 'end',
    };
    const sourceEvent = eventMap[event];
    if (!sourceEvent) throw new Error('Unsupported bot event.');
    const matches = compileTriggerFilter({ event: 'chat', filter: match });
    const dataOf = (args) => {
      if (event === 'chat') return String(args[0] ?? '');
      if (event === 'kicked') return toChatLine(args[0]).message;
      if (event === 'window') return mcpGetInventory();
      if (event === 'health') return { health: bot.health, food: bot.food };
      return args[0] ?? null;
    };
    return new Promise((resolve) => {
      const source = event === 'inventory' ? bot.inventory : bot;
      const finish = (...args) => {
        const data = dataOf(args);
        if (match && !matches(typeof data === 'string' ? data : JSON.stringify(data))) return;
        clearTimeout(timer);
        source.removeListener(sourceEvent, finish);
        resolve({ event, timestamp: Date.now(), data });
      };
      const timer = setTimeout(() => {
        source.removeListener(sourceEvent, finish);
        resolve({ event, timestamp: Date.now(), timedOut: true });
      }, timeout);
      source.on(sourceEvent, finish);
    });
  }

  async function mcpRecipeAction({ actionId, inputs } = {}) {
    if (actionId === 'botJoin')
      throw new Error('Joining is handled by the MCP-owned session.');
    const handler = getRecipeActionHandler(String(actionId));
    return handler(
      {
        getBot: () => bot,
        setBot: () => {
          throw new Error('This action cannot replace the active bot.');
        },
      },
      inputs ?? {},
    );
  }

  async function getChunkDump() {
    let chunks = [];
    let positions = [];
    if (!bot.world?.async) {
      console.warn('World has not loaded yet...');
      await bot.waitForChunksToLoad();
    }
    console.time('getChunks');
    const center = currentMapCenter();
    for (let chunk of bot.world.async.getColumns()) {
      const x = Number(chunk.chunkX);
      const z = Number(chunk.chunkZ);
      if (!isInMapWindow(x, z, center)) continue;
      chunks.push(bot.dumpChunk(chunk.column));
      positions.push([x, z]);
    }
    console.timeEnd('getChunks');
    sendData.map = [];
    mapWindowCenter = center;
    mapWindowDistance = mapRenderDistance();
    publishedMapChunks.clear();
    for (const [x, z] of positions) publishedMapChunks.add(mapChunkKey(x, z));
    return [chunks, positions, bot.entity.position.toArray()]; // Return chunks, positions and player position
  }

  async function runCode(code) {
    try {
      return await runJsBotCode({ code, bot });
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  function runAutomation(options) {
    return startBotAutomation(bot, options);
  }

  function controlAutomation(options) {
    return controlBotAutomation(bot, options);
  }
  async function mcpRunCode({ code, timeoutMs } = {}) {
    const logs = [];
    const result = await runJsBotCode({
      code: String(code ?? ''),
      bot,
      timeoutMs,
      onLog(entry) {
        if (logs.length < 200)
          logs.push({ ...entry, message: entry.message.slice(0, 4_000) });
      },
    });
    const serialized = result === undefined ? null : JSON.stringify(result);
    if (serialized && Buffer.byteLength(serialized) > 256 * 1024)
      throw new Error('Bot script result is too large.');
    return {
      result: serialized === null ? null : JSON.parse(serialized),
      logs,
    };
  }

  // -------------------- Send data ------------------ \\

  bot.on('health', infoPacket);
  bot.on('gamemodeChanged', infoPacket);
  bot.on('heldItemChanged', publishInventory);
  bot.once('end', cleanup);
  bot.on('experience', infoPacket);
  bot.on('physicsTick', publishMovementChange);

  function cleanup() {
    void stopBotAutomation(bot);
    clearImmediate(inventoryPublish);
    sendData.chat = [];
    sendData.map = [];
    mapWindowGeneration += 1;
    publishedMapChunks.clear();
    mapWindowCenter = null;
    mapWindowDistance = null;
    lastMovementPos = null;
    bot.removeListener('move', moveHandler);
    bot.removeListener('forcedMove', forceMoveHandler);
    bot.removeListener('health', infoPacket);
    bot.removeListener('gamemodeChanged', infoPacket);
    bot.removeListener('heldItemChanged', publishInventory);
    bot.removeListener('experience', infoPacket);
    bot.removeListener('physicsTick', publishMovementChange);
    bot.removeListener('game', resetMapWindow);
    bot.removeListener('game', clearSelectedItem);
    bot.removeListener('gamemodeChanged', clearSelectedItem);
    prompts.dispose();
    disposeChunkSubscription?.();
    clearInterval(entityTimer);
    disposeEntitySubscription?.();
    disposeAdditionalEntitySubscription?.();
    disposeEntityUnsubscription?.();
    for (const [event, handler] of Object.entries(eventHandlers))
      if (event !== 'end') bot.removeListener(event, handler);
    bot.removeListener('end', cleanup);
    disposeTerminate();
  }
  bot.actions = {
    chatMessage,
    joinGamemode,
    respawn,
    movementPacket,
    closeWindow,
    updateSign: prompts.updateSign,
    dialogAction: prompts.dialogAction,
    closePrompt: prompts.closePrompt,
    renameItem,
    setHotbar,
    infoPacket,
    inventoryClick,
    tossItems,
    activateItem,
    mouse,
    toggleMovement,
    stopMovement,
    startPathFinder,
    leave,
    setHeadRotation,
    eat,
    chatPacket,
    tabComplete,
    login,
    triggersPacket: () => triggers.publish(),
    testTrigger: (id) => triggers.test(id),
    runScriptAction,
    mcpRunPluginAction,
    sendInventoryPacket,
    getChunkDump,
    runCode,
    runAutomation,
    controlAutomation,
    mcpRunCode,
    mcpGetState,
    editorContext,
    mcpGetChat,
    mcpGetInventory,
    mcpGetPlayers,
    mcpGetNearbyEntities,
    mcpGetBlockAt,
    mcpFindBlocks,
    mcpWaitForEvent,
    mcpGetEvents,
    mcpRecipeAction,
  };
};

module.exports = inject;
