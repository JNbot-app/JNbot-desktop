import { createSerializer, states } from 'minecraft-protocol';
import ChunkFactory from 'prismarine-chunk';
import { ProxyStateCompiler } from '../../src/main/src/workers/bot/proxyV3/ProxyStateCompiler';
import {
  ANY_PACKET,
  PacketContext,
  PacketPipeline,
} from '../../src/main/src/workers/bot/proxyV3/PacketPipeline';

const packet = (direction: 'c2s' | 's2c' = 'c2s') =>
  new PacketContext({
    name: 'chat',
    state: states.PLAY,
    direction,
    data: { message: 'hello' },
    buffer: Buffer.from([0x01]),
  });

const semanticSnapshot = (overrides: Record<string, unknown> = {}) => ({
  protocol: 774,
  boundary: 0,
  capabilities: ['world', 'inventory', 'health', 'position'],
  handshake: { configuration: [], login: Buffer.from([1]), singletons: [] },
  game: { viewDistance: 8, dimension: { name: 'overworld', minY: -64, height: 384 } },
  player: {
    position: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
    health: 20,
    food: 20,
    foodSaturation: 5,
    experienceBar: 0,
    experienceLevel: 0,
    totalExperience: 0,
    selectedSlot: 0,
  },
  world: { chunks: [] as any[] },
  inventory: { items: [] },
  ...overrides,
});

const compile = (version: string | number, snapshot: any) => [
  ...new ProxyStateCompiler(version).compile(snapshot),
];

function decodeChunk(version: string, data: any, minY: number, worldHeight: number) {
  const serializer = createSerializer({ state: states.PLAY, isServer: true, version } as any);
  const raw = serializer.createPacketBuffer({ name: 'map_chunk', params: data });
  const decoded = serializer.proto.parsePacketBuffer('packet', raw).data.params;
  serializer.destroy();
  const Chunk = ChunkFactory(version) as any;
  new Chunk({ minY, worldHeight }).load(decoded.chunkData);
}

describe('proxy state compiler', () => {
  test('positions the player and dismisses the terrain screen before the chunk batch', async () => {
    const names = (compile('1.21.11', semanticSnapshot())).map((p) => p.name);
    expect(names.indexOf('game_state_change')).toBeLessThan(names.indexOf('position'));
    expect(names.indexOf('position')).toBeLessThan(names.indexOf('chunk_batch_start'));
    expect(names.indexOf('chunk_batch_start')).toBeLessThan(names.indexOf('chunk_batch_finished'));
    expect(names).not.toContain('login');
  });

  test('closes chunk_batch_finished before streaming entities', async () => {
    const Chunk = ChunkFactory('1.21.11') as any;
    const column = new Chunk({ minY: -64, worldHeight: 384 });
    const names = compile(
      '1.21.11',
      semanticSnapshot({
        world: { chunks: [{ x: 0, z: 0, column: column.toJson(), heightmaps: [] }] },
        entities: [
          {
            id: 200,
            uuid: '11111111-1111-1111-1111-111111111111',
            type: 1,
            name: 'zombie',
            position: { x: 10, y: 64, z: 10 },
          },
        ],
      }),
    ).map((p) => p.name);
    expect(names.indexOf('chunk_batch_start')).toBeLessThan(names.indexOf('map_chunk'));
    expect(names.indexOf('map_chunk')).toBeLessThan(names.indexOf('chunk_batch_finished'));
    expect(names.indexOf('chunk_batch_finished')).toBeLessThan(names.indexOf('spawn_entity'));
  });

  test('accepts a protocol number as the version', async () => {
    const names = (compile(774, semanticSnapshot())).map((p) => p.name);
    expect(names).toContain('position');
  });

  test('rejects a snapshot for another protocol', () => {
    expect(() => compile('1.21.11', semanticSnapshot({ protocol: 47 }))).toThrow(
      'different protocol',
    );
  });

  test.each([
    ['the provider dimension', -64, 384],
    ['a custom dimension height', 0, 256],
  ])('round-trips 1.21.11 chunk data with %s', (_, minY, height) => {
    const Chunk = ChunkFactory('1.21.11') as any;
    const column = new Chunk({ minY, worldHeight: height });
    const snapshot = semanticSnapshot({
      game: { dimension: { name: 'overworld', minY, height } },
      world: { chunks: [{ x: 0, z: 0, column: column.toJson(), heightmaps: [] }] },
    });
    const chunk = (compile('1.21.11', snapshot)).find((p) => p.name === 'map_chunk');
    expect(chunk?.data.heightmaps).toEqual([]);
    expect(() => decodeChunk('1.21.11', chunk.data, minY, height)).not.toThrow();
  });
});

describe('proxy v3 packet pipeline', () => {
  test('runs wildcard and named handlers for both directions', () => {
    const pipeline = new PacketPipeline();
    const received: string[] = [];
    pipeline.on(ANY_PACKET, (context) =>
      received.push(`all:${context.direction}`),
    );
    pipeline.on('chat', (context) =>
      received.push(`chat:${context.direction}`),
    );

    pipeline.run(packet('c2s'));
    pipeline.run(packet('s2c'));

    expect(received).toEqual(['all:c2s', 'chat:c2s', 'all:s2c', 'chat:s2c']);
  });

  test('supports one-time and removable handlers', () => {
    const pipeline = new PacketPipeline();
    const once = jest.fn();
    const removable = jest.fn();
    pipeline.once('chat', once);
    pipeline.on('chat', removable);
    pipeline.off('chat', removable);

    pipeline.run(packet());
    pipeline.run(packet());

    expect(once).toHaveBeenCalledTimes(1);
    expect(removable).not.toHaveBeenCalled();
  });

  test('runs matching handlers once in registration order', () => {
    const pipeline = new PacketPipeline();
    const calls: string[] = [];
    const shared = () => calls.push('shared');

    pipeline.on('chat', () => calls.push('named-first'));
    pipeline.on('*', () => calls.push('wildcard-second'));
    pipeline.on(['*', 'chat'], shared);
    pipeline.run(packet());

    expect(calls).toEqual(['named-first', 'wildcard-second', 'shared']);
  });

  test('rolls back edits and injections when a handler fails', () => {
    const pipeline = new PacketPipeline();
    const context = packet();
    const later = jest.fn();

    pipeline.on('chat', (ctx) => {
      ctx.data.message = 'changed';
      ctx.markModified().inject('keep_alive', { keepAliveId: 1 }).drop();
      throw new Error('broken plugin');
    });
    pipeline.on('chat', later);

    pipeline.run(context);

    expect(context.data).toEqual({ message: 'hello' });
    expect(context.isModified).toBe(false);
    expect(context.isDropped).toBe(true);
    expect(context.injected).toEqual([]);
    expect(context.failure?.code).toBe('handler_error');
    expect(later).not.toHaveBeenCalled();
  });

  test('rejects async packet handlers and restores original output', () => {
    const pipeline = new PacketPipeline();
    const context = packet();

    pipeline.on('chat', ((ctx: PacketContext) => {
      ctx.data.message = 'late';
      ctx.markModified();
      return Promise.resolve();
    }) as any);

    pipeline.run(context);

    expect(context.data).toEqual({ message: 'hello' });
    expect(context.isModified).toBe(false);
    expect(context.failure?.code).toBe('async_handler');
  });

  test('records decoded edits, drops, and parsed injection', () => {
    const context = packet();
    context.data = { message: 'changed' };
    context.markModified().inject('keep_alive', { keepAliveId: 1 }).drop();

    expect(context.data).toEqual({ message: 'changed' });
    expect(context.isModified).toBe(true);
    expect(context.isDropped).toBe(true);
    expect(context.injected).toEqual([
      { kind: 'parsed', name: 'keep_alive', data: { keepAliveId: 1 } },
    ]);
  });

  test('replaces and injects raw packets, including undecodable packets', () => {
    const context = new PacketContext({
      name: 'unknown_99',
      state: states.PLAY,
      direction: 's2c',
      data: null,
      buffer: Buffer.from([0x63]),
      unparsed: true,
    });
    context
      .replaceRaw(Uint8Array.from([0x03, 0x04]))
      .injectRaw(Uint8Array.from([0x05]));

    expect(context.unparsed).toBe(true);
    expect([...context.raw]).toEqual([0x03, 0x04]);
    expect(context.isModified).toBe(false);
    expect(context.injected).toEqual([
      { kind: 'raw', raw: Buffer.from([0x05]) },
    ]);
  });
});
