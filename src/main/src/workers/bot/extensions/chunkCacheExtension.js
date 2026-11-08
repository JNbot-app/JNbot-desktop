/**
 * Bounded chunk storage, modelled on the vanilla `ClientChunkCache`.
 *
 * Mineflayer stores every chunk it is sent and only drops one on an explicit
 * `unload_chunk`. Like a vanilla client, this keeps chunks in a fixed square
 * ring of `2 * range + 1` slots: chunks outside `range` of the view center are
 * ignored and a chunk replaces whatever older chunk shares its slot. Moving
 * the center drops nothing by itself. Servers behind ViaVersion (e.g. Pika)
 * move the center onto every far chunk they stream, so without this the bot's
 * world grows without bound.
 *
 * `range` is the bot's render distance (the `render_distance` setting, 2 on
 * mobile) plus the one border chunk servers send, not vanilla's `+3`: bots
 * rarely need more of the world, and memory matters. `chunkLoadLimit` (join
 * option) caps it further. Without a server view center (pre-1.14) the range
 * is measured around the bot's own chunk.
 *
 * Loaded before packetThreadExtension, so chunks are filtered when they are
 * handled, after the view center that precedes them.
 */
const CLIENT_VIEW_DISTANCE = { far: 12, normal: 10, short: 8, tiny: 6 };

const floorMod = (n, m) => ((n % m) + m) % m;

function chunkCacheExtension(bot, options = {}) {
  const client = bot._client;
  const limit =
    typeof options.chunkLoadLimit === 'number' && options.chunkLoadLimit > 0
      ? options.chunkLoadLimit
      : Infinity;
  let viewCenter = null;
  let serverViewDistance = null;
  /** Ring slot → key of the chunk stored in it. */
  let slots = new Map();

  function clientViewDistance() {
    const setting = bot.settings?.viewDistance;
    return typeof setting === 'number' ? setting : (CLIENT_VIEW_DISTANCE[setting] ?? 12);
  }

  function range() {
    const viewDistance = Math.min(clientViewDistance(), serverViewDistance ?? Infinity);
    return Math.min(limit, viewDistance + 1);
  }

  function center() {
    if (viewCenter) return viewCenter;
    // Mineflayer sets the height with the first position packet; until then
    // the position is a placeholder and every chunk is kept.
    if (!bot.entity?.height) return null;
    const { x, z } = bot.entity.position;
    return { x: Math.floor(x / 16), z: Math.floor(z / 16) };
  }

  function inRange(x, z) {
    const c = center();
    return !c || Math.max(Math.abs(x - c.x), Math.abs(z - c.z)) <= range();
  }

  function slotOf(x, z) {
    const size = 2 * range() + 1;
    return floorMod(z, size) * size + floorMod(x, size);
  }

  /** Store a loaded chunk, evicting the older chunk in its slot. */
  function store(x, z) {
    const slot = slotOf(x, z);
    const previous = slots.get(slot);
    slots.set(slot, `${x},${z}`);
    if (!previous || previous === `${x},${z}`) return;
    const [px, pz] = previous.split(',').map(Number);
    bot.world.unloadColumn(px, pz);
  }

  /** The ring changed size or moved without a server center: keep what is still in range. */
  function rebuild() {
    slots = new Map();
    if (!bot.world?.async) return;
    for (const { chunkX, chunkZ } of bot.world.async.getColumns()) {
      const x = Number(chunkX);
      const z = Number(chunkZ);
      if (inRange(x, z)) store(x, z);
      else bot.world.unloadColumn(x, z);
    }
  }

  const emit = client.emit;
  client.emit = function (event, packet, ...rest) {
    if (event === 'update_light' && !inRange(packet.chunkX, packet.chunkZ)) return false;
    if (event !== 'map_chunk') return emit.call(this, event, packet, ...rest);
    if (!inRange(packet.x, packet.z)) return false;
    const result = emit.call(this, event, packet, ...rest);
    store(packet.x, packet.z);
    return result;
  };

  bot.on('chunkColumnUnload', (corner) => {
    const key = `${corner.x >> 4},${corner.z >> 4}`;
    const slot = slotOf(corner.x >> 4, corner.z >> 4);
    if (slots.get(slot) === key) slots.delete(slot);
  });
  client.on('login', (packet) => {
    viewCenter = null;
    serverViewDistance = packet.viewDistance || null;
    slots = new Map();
  });
  client.on('respawn', () => {
    viewCenter = null;
  });
  client.on('update_view_distance', (packet) => {
    serverViewDistance = packet.viewDistance || null;
    rebuild();
  });
  client.on('update_view_position', (packet) => {
    viewCenter = { x: packet.chunkX, z: packet.chunkZ };
  });
  // Without a server center the range follows the bot.
  bot.on('forcedMove', () => !viewCenter && rebuild());

  if (limit < 2) bot.waitForChunksToLoad = async () => {};
}

module.exports = chunkCacheExtension;
