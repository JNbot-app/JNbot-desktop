/**
 * Aggressive chunk filter extension for Mineflayer bots.
 * Discards all chunks outside the specified render distance radius around the bot,
 * preventing them from being parsed or stored in memory.
 */

function applyChunkRenderDistanceFilter(bot, chunkRenderDistance) {
  if (typeof chunkRenderDistance !== 'number' || chunkRenderDistance <= 0) return;

  let initialPositionKnown = false;
  const pendingPackets = [];

  function getBotChunkPos() {
    if (!initialPositionKnown || !bot.entity?.position) return null;
    return {
      x: Math.floor(bot.entity.position.x / 16),
      z: Math.floor(bot.entity.position.z / 16),
    };
  }

  function isWithinRenderDistance(chunkX, chunkZ) {
    const botChunk = getBotChunkPos();
    if (!botChunk) return true;
    return (
      Math.max(
        Math.abs(chunkX - botChunk.x),
        Math.abs(chunkZ - botChunk.z),
      ) <= chunkRenderDistance
    );
  }

  function flushPendingPackets() {
    if (initialPositionKnown) return;
    initialPositionKnown = true;
    const packets = pendingPackets.splice(0, pendingPackets.length);
    for (const item of packets) {
      if (item.name === 'map_chunk') {
        if (isWithinRenderDistance(item.packet.x, item.packet.z)) {
          origEmit.call(bot._client, item.name, item.packet, ...item.rest);
        }
      } else if (item.name === 'update_light') {
        if (isWithinRenderDistance(item.packet.chunkX, item.packet.chunkZ)) {
          origEmit.call(bot._client, item.name, item.packet, ...item.rest);
        }
      }
    }
  }

  bot.once('forcedMove', flushPendingPackets);
  bot.once('spawn', flushPendingPackets);

  bot.on('respawn', () => {
    initialPositionKnown = false;
    pendingPackets.length = 0;
  });

  bot.on('end', () => {
    pendingPackets.length = 0;
  });

  if (chunkRenderDistance < 2) {
    bot.waitForChunksToLoad = async () => {};
  }

  let origEmit;
  if (bot._client) {
    origEmit = bot._client.emit;
    bot._client.emit = function (name, packet, ...rest) {
      if (name === 'map_chunk') {
        if (!initialPositionKnown) {
          if (bot.entity?.position && (bot.entity.height || bot.entity.position.y !== 0)) {
            flushPendingPackets();
          } else {
            pendingPackets.push({ name, packet, rest });
            return false;
          }
        }
        if (!isWithinRenderDistance(packet.x, packet.z)) {
          return false;
        }
      } else if (name === 'update_light') {
        if (!initialPositionKnown) {
          if (bot.entity?.position && (bot.entity.height || bot.entity.position.y !== 0)) {
            flushPendingPackets();
          } else {
            pendingPackets.push({ name, packet, rest });
            return false;
          }
        }
        if (!isWithinRenderDistance(packet.chunkX, packet.chunkZ)) {
          return false;
        }
      }
      return origEmit.call(this, name, packet, ...rest);
    };
  }

  if (bot.world?.setColumn) {
    const origSetColumn = bot.world.setColumn.bind(bot.world);
    bot.world.setColumn = function (chunkX, chunkZ, column) {
      if (initialPositionKnown && !isWithinRenderDistance(chunkX, chunkZ)) {
        return;
      }
      return origSetColumn(chunkX, chunkZ, column);
    };
  }
}

module.exports = { applyChunkRenderDistanceFilter };
