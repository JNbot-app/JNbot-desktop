const { EventEmitter } = require('events');
const {
  applyChunkRenderDistanceFilter,
} = require('../../src/main/src/workers/bot/extensions/chunkFilterExtension');

describe('aggressive chunk render distance filter', () => {
  function createMockBot() {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.world = {
      columns: {},
      setColumn: jest.fn(function (x, z, column) {
        this.columns[`${x},${z}`] = column;
      }),
    };
    bot.entity = {
      position: { x: 160, y: 64, z: 320 }, // chunk coords: (10, 20)
      height: 1.8,
    };
    bot.waitForChunksToLoad = jest.fn();
    return bot;
  }

  test('discards map_chunk and update_light packets outside render distance', () => {
    const bot = createMockBot();
    applyChunkRenderDistanceFilter(bot, 2);

    // Trigger position initialization
    bot.emit('forcedMove');

    const emitted = [];
    bot._client.on('map_chunk', (p) => emitted.push({ type: 'map_chunk', x: p.x, z: p.z }));
    bot._client.on('update_light', (p) =>
      emitted.push({ type: 'update_light', chunkX: p.chunkX, chunkZ: p.chunkZ }),
    );

    // Chunks within render distance (center is 10, 20; dist is 2 -> X: 8..12, Z: 18..22)
    bot._client.emit('map_chunk', { x: 10, z: 20 });
    bot._client.emit('map_chunk', { x: 8, z: 22 });
    bot._client.emit('update_light', { chunkX: 11, chunkZ: 19 });

    // Chunks outside render distance
    bot._client.emit('map_chunk', { x: 13, z: 20 });
    bot._client.emit('map_chunk', { x: 10, z: 23 });
    bot._client.emit('update_light', { chunkX: 20, chunkZ: 20 });

    expect(emitted).toEqual([
      { type: 'map_chunk', x: 10, z: 20 },
      { type: 'map_chunk', x: 8, z: 22 },
      { type: 'update_light', chunkX: 11, chunkZ: 19 },
    ]);
  });

  test('buffers pre-spawn chunks and flushes only in-distance chunks when position is set', () => {
    const bot = new EventEmitter();
    bot._client = new EventEmitter();
    bot.world = {
      columns: {},
      setColumn: jest.fn(),
    };
    bot.entity = null; // Position not known yet

    applyChunkRenderDistanceFilter(bot, 2);

    const emitted = [];
    bot._client.on('map_chunk', (p) => emitted.push({ x: p.x, z: p.z }));

    // Send chunks before bot position is known
    bot._client.emit('map_chunk', { x: 0, z: 0 });
    bot._client.emit('map_chunk', { x: 5, z: 5 });
    bot._client.emit('map_chunk', { x: 20, z: 20 });

    // Nothing emitted yet
    expect(emitted).toHaveLength(0);

    // Server sets position: bot is at chunk (5, 5)
    bot.entity = {
      position: { x: 80, y: 64, z: 80 },
      height: 1.8,
    };
    bot.emit('spawn');

    // Only chunk (5, 5) is within radius 2 of (5, 5); (0, 0) and (20, 20) are discarded
    expect(emitted).toEqual([{ x: 5, z: 5 }]);
  });

  test('blocks world.setColumn for chunks outside render distance', () => {
    const bot = createMockBot();
    applyChunkRenderDistanceFilter(bot, 2);
    bot.emit('spawn');

    bot.world.setColumn(10, 20, { id: 'in_range' });
    bot.world.setColumn(25, 25, { id: 'out_of_range' });

    expect(bot.world.columns['10,20']).toEqual({ id: 'in_range' });
    expect(bot.world.columns['25,25']).toBeUndefined();
  });

  test('does not filter chunks when renderDistance is null or undefined', () => {
    const bot = createMockBot();
    applyChunkRenderDistanceFilter(bot, null);

    const emitted = [];
    bot._client.on('map_chunk', (p) => emitted.push({ x: p.x, z: p.z }));

    bot._client.emit('map_chunk', { x: 100, z: 100 });
    expect(emitted).toEqual([{ x: 100, z: 100 }]);
  });
});
