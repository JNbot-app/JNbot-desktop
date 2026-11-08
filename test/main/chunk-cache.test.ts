import { EventEmitter } from 'node:events';

const chunkCacheExtension = require('../../src/main/src/workers/bot/extensions/chunkCacheExtension');

/** A mineflayer double: a packet client plus a world that records loaded columns. */
function createBot({ viewDistance = 12 as number | string, position = null as any } = {}) {
  const loaded = new Set<string>();
  const bot: any = Object.assign(new EventEmitter(), {
    _client: new EventEmitter(),
    settings: { viewDistance },
    // Mineflayer sets the height with the first position packet.
    entity: position ? { position, height: 1.8 } : { position: { x: 0, y: 0, z: 0 } },
    world: {
      async: {
        getColumns: () =>
          [...loaded].map((key) => {
            const [chunkX, chunkZ] = key.split(',');
            return { chunkX, chunkZ };
          }),
      },
      unloadColumn: jest.fn((x: number, z: number) => loaded.delete(`${x},${z}`)),
    },
  });
  // Stands in for mineflayer's own map_chunk handler.
  bot._client.on('map_chunk', (packet: any) => loaded.add(`${packet.x},${packet.z}`));
  return { bot, loaded, client: bot._client as EventEmitter };
}

describe('chunk cache', () => {
  test('keeps the render distance plus one border chunk around the view center', () => {
    const { bot, client, loaded } = createBot({ viewDistance: 12 });
    chunkCacheExtension(bot);
    client.emit('login', { viewDistance: 64 });
    client.emit('update_view_position', { chunkX: 0, chunkZ: 0 });

    const light: any[] = [];
    client.on('update_light', (packet) => light.push(packet));
    client.emit('map_chunk', { x: 13, z: -13 });
    client.emit('map_chunk', { x: 14, z: 0 });
    client.emit('update_light', { chunkX: 0, chunkZ: 13 });
    client.emit('update_light', { chunkX: 0, chunkZ: 14 });

    // The bot's 12 wins over the server's 64: range 13.
    expect([...loaded]).toEqual(['13,-13']);
    expect(light).toEqual([{ chunkX: 0, chunkZ: 13 }]);
  });

  test('a low render distance (mobile) keeps only a small square', () => {
    const { bot, client, loaded } = createBot({ viewDistance: 2 });
    chunkCacheExtension(bot);
    client.emit('login', { viewDistance: 64 });
    client.emit('update_view_position', { chunkX: 0, chunkZ: 0 });
    for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) client.emit('map_chunk', { x, z });
    expect(loaded.size).toBe(7 * 7);
  });

  test('stays bounded when the server streams far-away chunks (ViaVersion)', () => {
    const { bot, client, loaded } = createBot({ viewDistance: 12 });
    chunkCacheExtension(bot);
    client.emit('login', { viewDistance: 64 });
    client.emit('update_view_position', { chunkX: 0, chunkZ: 1 });
    client.emit('map_chunk', { x: 0, z: 1 }); // the chunk the bot stands in
    // Recorded on Pika: the center jumps onto every far chunk before it is sent.
    for (let x = -21; x > -1000; x--) {
      client.emit('update_view_position', { chunkX: x, chunkZ: 20 });
      client.emit('map_chunk', { x, z: 20 });
    }
    client.emit('update_view_position', { chunkX: 0, chunkZ: 1 });

    // A ring of 27 x 27 slots: one row of the stream plus the bot's own chunk,
    // which moving the center away (and back) must not drop.
    expect(loaded.size).toBe(28);
    expect(loaded.has('0,1')).toBe(true);
    expect(loaded.has('-21,20')).toBe(false);
  });

  test('a chunk replaces the older chunk in its ring slot', () => {
    const { bot, client, loaded } = createBot({ viewDistance: 4 });
    chunkCacheExtension(bot);
    client.emit('login', { viewDistance: 4 }); // range 5, ring of 11
    client.emit('update_view_position', { chunkX: 0, chunkZ: 0 });
    client.emit('map_chunk', { x: 3, z: 0 });
    client.emit('update_view_position', { chunkX: 10, chunkZ: 0 });
    client.emit('map_chunk', { x: 14, z: 0 }); // 14 mod 11 = 3
    expect([...loaded]).toEqual(['14,0']);
  });

  test('a smaller server view distance unloads the columns outside it', () => {
    const { bot, client, loaded } = createBot({ viewDistance: 12 });
    chunkCacheExtension(bot);
    client.emit('login', { viewDistance: 12 });
    client.emit('update_view_position', { chunkX: 0, chunkZ: 0 });
    client.emit('map_chunk', { x: 0, z: 0 });
    client.emit('map_chunk', { x: 10, z: 0 });

    client.emit('update_view_distance', { viewDistance: 4 });
    expect([...loaded]).toEqual(['0,0']);
  });

  test('keeps every chunk until the bot has a position or a view center', () => {
    const { bot, client, loaded } = createBot({ viewDistance: 'far' });
    chunkCacheExtension(bot);
    client.emit('login', { viewDistance: 10 });
    client.emit('map_chunk', { x: 500, z: 500 });
    expect(loaded.has('500,500')).toBe(true);

    // Pre-1.14 servers send no view center: the first position decides.
    bot.entity = { position: { x: 0, y: 64, z: 0 }, height: 1.8 };
    bot.emit('forcedMove');
    expect(loaded.size).toBe(0);
  });

  test('chunkLoadLimit caps the range around the bot without a view center', () => {
    const position = { x: 160, y: 64, z: 320 }; // chunk (10, 20)
    const { bot, client, loaded } = createBot({ position });
    chunkCacheExtension(bot, { chunkLoadLimit: 2 });

    client.emit('map_chunk', { x: 12, z: 18 });
    client.emit('map_chunk', { x: 13, z: 20 });
    expect([...loaded]).toEqual(['12,18']);

    position.x = 0; // teleported to chunk (0, 20)
    bot.emit('forcedMove');
    expect(loaded.size).toBe(0);
  });

  test('chunkLoadLimit also caps the view center range', () => {
    const { bot, client, loaded } = createBot();
    chunkCacheExtension(bot, { chunkLoadLimit: 1 });
    client.emit('login', { viewDistance: 32 });
    client.emit('update_view_position', { chunkX: 0, chunkZ: 0 });
    client.emit('map_chunk', { x: 1, z: 1 });
    client.emit('map_chunk', { x: 2, z: 0 });
    expect([...loaded]).toEqual(['1,1']);
  });
});
