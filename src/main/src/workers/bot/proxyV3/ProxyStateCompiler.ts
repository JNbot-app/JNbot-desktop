import minecraftData from 'minecraft-data';
import ChunkFactory from 'prismarine-chunk';
import ItemFactory from 'prismarine-item';
import RegistryFactory from 'prismarine-registry';
import type {
  ProxyPacketData,
  ProxyStateEntity,
  ProxyStateChunk,
  ProxyStateSnapshot,
} from '../../../../../common/types/proxyApi';

/** A snapshot the provider exported as a semantic world (a bot), not as raw packets. */
type WorldSnapshot = ProxyStateSnapshot &
  Required<Pick<ProxyStateSnapshot, 'game' | 'player' | 'world' | 'inventory'>>;

export interface CompiledStatePacket {
  phase: string;
  name: string;
  data: ProxyPacketData;
}

type ProtocolData = ReturnType<typeof minecraftData>;

function packetFields(data: ProtocolData, name: string): Set<string> {
  const type = (data.protocol.play.toClient.types as Record<string, unknown>)[
    `packet_${name}`
  ];
  if (
    !Array.isArray(type) ||
    type[0] !== 'container' ||
    !Array.isArray(type[1])
  )
    return new Set();
  return new Set(
    type[1]
      .filter(
        (field): field is { name: string } =>
          typeof field === 'object' && field !== null && 'name' in field,
      )
      .map((field) => field.name),
  );
}

function supported(
  data: ProxyPacketData,
  fields: Set<string>,
): ProxyPacketData {
  if (!fields.size) return data;
  return Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) => value !== undefined && fields.has(key),
    ),
  );
}

function packetExists(data: ProtocolData, name: string): boolean {
  return `packet_${name}` in (data.protocol.play.toClient.types as object);
}

function isValidProtocolMetadata(
  metadata: unknown,
): metadata is Array<{ key: number; type?: unknown; value?: unknown }> {
  if (!Array.isArray(metadata) || metadata.length === 0) return false;
  return metadata.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'key' in entry &&
      ('type' in entry || 'value' in entry),
  );
}

function restoreSnapshotColumn(
  Chunk: any,
  saved: ProxyStateChunk,
  defaultMinY = 0,
  defaultHeight = 256,
) {
  if (typeof saved.column === 'string') {
    return restoreColumn(Chunk, saved.column, defaultMinY, defaultHeight);
  }
  const column = new Chunk({
    minY: saved.column.minY ?? defaultMinY,
    worldHeight: saved.column.height ?? defaultHeight,
  });
  column.load(Buffer.from(saved.column.sectionData, 'base64'));
  return column;
}

type ChunkPaletteColumn = {
  minY?: number;
  worldHeight?: number;
  sections?: Array<{ data?: { noSizePrefix?: boolean } }>;
  biomes?: Array<{ data?: { noSizePrefix?: boolean } }>;
};

type ChunkColumn = ChunkPaletteColumn & {
  dump(): Buffer;
  dumpLight?(): ProxyPacketData;
  getMask?(): number;
  dumpBiomes?(): unknown;
  blockEntities?: Record<string, unknown>;
};

type ChunkConstructor = {
  new (_options: { minY?: number; worldHeight?: number }): ChunkColumn;
  fromJson(_saved: string): ChunkColumn;
};

function restoreColumn(
  Chunk: ChunkConstructor,
  saved: string,
  defaultMinY?: number,
  defaultHeight?: number,
) {
  const column = Chunk.fromJson(saved);
  const template = new Chunk({
    minY: column.minY ?? defaultMinY,
    worldHeight: column.worldHeight ?? defaultHeight,
  });
  // prismarine-chunk's portable JSON omits the palette wire-format flag on
  // biome containers. Use a fresh column for this protocol as the source of
  // truth instead of comparing Minecraft version strings.
  (['sections', 'biomes'] as const).forEach((key) => {
    const restored = column[key];
    const format = template[key];
    if (!restored || !format) return;
    restored.forEach((section, index) => {
      const restoredData = section.data;
      const formatData = format[index]?.data;
      if (restoredData && formatData && 'noSizePrefix' in formatData)
        restoredData.noSizePrefix = formatData.noSizePrefix;
    });
  });
  return column;
}

/** Exported items may lack the component lists 1.20.5+ encoding reads; default them. */
function toNotch(Item: any, item: any) {
  return Item.toNotch(
    item && { ...item, components: item.components ?? [], removedComponents: item.removedComponents ?? [] },
  );
}

function positionPacket(
  data: ProtocolData,
  state: WorldSnapshot,
): ProxyPacketData {
  const fields = packetFields(data, 'position');
  const { position } = state.player;
  return supported(
    {
      teleportId: state.synchronization?.teleportId ?? 0,
      x: position.x,
      y: position.y,
      z: position.z,
      dx: 0,
      dy: 0,
      dz: 0,
      yaw: position.yaw,
      pitch: position.pitch,
      flags: 0,
    },
    fields,
  );
}

/**
 * Builds a new client's initial state from semantic Prismarine models. This is
 * intentionally the only module that knows packet field names.
 */
export class ProxyStateCompiler {
  readonly data: ProtocolData;
  readonly version: string;
  readonly registry: any;

  /** A version name or protocol number (a proxy-side client's `version` is the latter). */
  constructor(version: string | number) {
    this.data = minecraftData(version);
    this.version = this.data.version.minecraftVersion!;
    this.registry = RegistryFactory(this.version);
  }

  #validate(snapshot: ProxyStateSnapshot): asserts snapshot is WorldSnapshot {
    if (
      String(snapshot.protocol) !== String(this.data.version.version) &&
      String(snapshot.protocol) !== this.version
    ) {
      throw new Error('Provider returned a different protocol');
    }
    if (!snapshot.game || !snapshot.player || !snapshot.world || !snapshot.inventory)
      throw new Error('Provider exported no world state');
  }

  *#bootstrap(snapshot: WorldSnapshot): Generator<CompiledStatePacket> {
    const { position } = snapshot.player;
    if (
      packetExists(this.data, 'game_state_change') &&
      this.data.version['>=']('1.20.3')
    ) {
      yield {
        phase: 'play',
        name: 'game_state_change',
        data: supported(
          { reason: 13, gameMode: 0 },
          packetFields(this.data, 'game_state_change'),
        ),
      };
    }
    if (packetExists(this.data, 'update_view_position'))
      yield { phase: 'play', name: 'update_view_position', data: supported({ chunkX: Math.floor(position.x / 16), chunkZ: Math.floor(position.z / 16) }, packetFields(this.data, 'update_view_position')) };
    if (packetExists(this.data, 'update_view_distance'))
      yield { phase: 'play', name: 'update_view_distance', data: supported({ viewDistance: snapshot.game.viewDistance ?? 10 }, packetFields(this.data, 'update_view_distance')) };
    yield { phase: 'play', name: 'position', data: positionPacket(this.data, snapshot) };
  }

  *#chunk(
    saved: ProxyStateChunk,
    snapshot?: WorldSnapshot,
  ): Generator<CompiledStatePacket> {
    const Chunk = ChunkFactory(this.registry) as any;
    const shape = snapshot?.game?.dimension;
    const column = restoreSnapshotColumn(Chunk, saved, shape?.minY ?? 0, shape?.height ?? 256);
    const fields = packetFields(this.data, 'map_chunk');
    const light = column.dumpLight?.() ?? {};
    if (fields.has('heightmaps') && saved.heightmaps === undefined)
      throw new Error(`Provider did not export heightmaps for chunk ${saved.x},${saved.z}`);
    yield {
      phase: 'play',
      name: 'map_chunk',
      data: supported(
        {
          x: saved.x,
          z: saved.z,
          groundUp: true,
          bitMap: column.getMask?.(),
          biomes: column.dumpBiomes?.(),
          heightmaps: saved.heightmaps,
          chunkData: column.dump(),
          blockEntities: Object.values(column.blockEntities ?? {}),
          ...light,
        },
        fields,
      ),
    };
  }

  *#entity(entity: ProxyStateEntity): Generator<CompiledStatePacket> {
    if (!entity || typeof entity.id !== 'number') return;
    const Item = ItemFactory(this.registry) as any;

    if (packetExists(this.data, 'spawn_entity')) {
      const typeId =
        typeof entity.type === 'number'
          ? entity.type
          : (this.data.entitiesByName?.[entity.name ?? '']?.id ??
            this.data.entitiesByName?.['player']?.id ??
            1);
      const fields = packetFields(this.data, 'spawn_entity');
      yield {
        phase: 'play',
        name: 'spawn_entity',
        data: supported(
          {
            entityId: entity.id,
            objectUUID: entity.uuid ?? '00000000-0000-0000-0000-000000000000',
            type: typeId,
            x: entity.position.x,
            y: entity.position.y,
            z: entity.position.z,
            velocity: {
              x: entity.velocity?.x ?? 0,
              y: entity.velocity?.y ?? 0,
              z: entity.velocity?.z ?? 0,
            },
            pitch: Math.floor(((entity.position.pitch ?? 0) * 256) / 360),
            yaw: Math.floor(((entity.position.yaw ?? 0) * 256) / 360),
            headPitch: Math.floor(
              ((entity.position.headYaw ?? entity.position.yaw ?? 0) * 256) / 360,
            ),
            headYaw: Math.floor(
              ((entity.position.headYaw ?? entity.position.yaw ?? 0) * 256) / 360,
            ),
            data: 0,
            objectData: 0,
          },
          fields,
        ),
      };
    } else if (
      packetExists(this.data, 'named_entity_spawn') &&
      (entity.name === 'player' || entity.type === 'player')
    ) {
      yield {
        phase: 'play',
        name: 'named_entity_spawn',
        data: supported(
          {
            entityId: entity.id,
            playerUUID: entity.uuid ?? '00000000-0000-0000-0000-000000000000',
            x: Math.floor(entity.position.x * 32),
            y: Math.floor(entity.position.y * 32),
            z: Math.floor(entity.position.z * 32),
            yaw: Math.floor(((entity.position.yaw ?? 0) * 256) / 360),
            pitch: Math.floor(((entity.position.pitch ?? 0) * 256) / 360),
            currentItem: 0,
            metadata: isValidProtocolMetadata(entity.metadata) ? entity.metadata : [],
          },
          packetFields(this.data, 'named_entity_spawn'),
        ),
      };
    } else if (packetExists(this.data, 'spawn_entity_living')) {
      const typeId =
        typeof entity.type === 'number'
          ? entity.type
          : (this.data.entitiesByName?.[entity.name ?? '']?.id ?? 1);
      yield {
        phase: 'play',
        name: 'spawn_entity_living',
        data: supported(
          {
            entityId: entity.id,
            type: typeId,
            x: Math.floor(entity.position.x * 32),
            y: Math.floor(entity.position.y * 32),
            z: Math.floor(entity.position.z * 32),
            yaw: Math.floor(((entity.position.yaw ?? 0) * 256) / 360),
            pitch: Math.floor(((entity.position.pitch ?? 0) * 256) / 360),
            headPitch: Math.floor(
              ((entity.position.headYaw ?? entity.position.yaw ?? 0) * 256) / 360,
            ),
            velocityX: 0,
            velocityY: 0,
            velocityZ: 0,
            metadata: isValidProtocolMetadata(entity.metadata) ? entity.metadata : [],
          },
          packetFields(this.data, 'spawn_entity_living'),
        ),
      };
    }

    if (isValidProtocolMetadata(entity.metadata) && packetExists(this.data, 'entity_metadata')) {
      yield {
        phase: 'play',
        name: 'entity_metadata',
        data: supported(
          {
            entityId: entity.id,
            metadata: entity.metadata,
          },
          packetFields(this.data, 'entity_metadata'),
        ),
      };
    }

    if (
      Array.isArray(entity.equipment) &&
      entity.equipment.length > 0 &&
      packetExists(this.data, 'entity_equipment')
    ) {
      const fields = packetFields(this.data, 'entity_equipment');
      if (fields.has('equipments')) {
        const equipments: Array<{ slot: number; item: unknown }> = [];
        for (const [idx, e] of entity.equipment.entries()) {
          if (!e) continue;
          equipments.push({
            slot: typeof (e as any).slot === 'number' ? (e as any).slot : idx,
            item: toNotch(Item, (e as any).item ?? e),
          });
        }
        if (equipments.length > 0) {
          yield {
            phase: 'play',
            name: 'entity_equipment',
            data: {
              entityId: entity.id,
              equipments,
            },
          };
        }
      } else {
        for (const [idx, e] of entity.equipment.entries()) {
          if (!e) continue;
          yield {
            phase: 'play',
            name: 'entity_equipment',
            data: supported(
              {
                entityId: entity.id,
                slot: typeof (e as any).slot === 'number' ? (e as any).slot : idx,
                item: toNotch(Item, (e as any).item ?? e),
              },
              fields,
            ),
          };
        }
      }
    }

    if (entity.velocity && packetExists(this.data, 'entity_velocity')) {
      const vx = Math.floor((entity.velocity.x ?? 0) * 8000);
      const vy = Math.floor((entity.velocity.y ?? 0) * 8000);
      const vz = Math.floor((entity.velocity.z ?? 0) * 8000);
      const fields = packetFields(this.data, 'entity_velocity');
      yield {
        phase: 'play',
        name: 'entity_velocity',
        data: supported(
          {
            entityId: entity.id,
            velocity: { x: vx, y: vy, z: vz },
            velocityX: vx,
            velocityY: vy,
            velocityZ: vz,
          },
          fields,
        ),
      };
    }
  }

  *#tail(snapshot: WorldSnapshot): Generator<CompiledStatePacket> {
    const Item = ItemFactory(this.registry) as any;
    const inventoryFields = packetFields(this.data, 'window_items');
    yield {
      phase: 'play',
      name: 'window_items',
      data: supported(
        {
          windowId: 0,
          stateId: snapshot.inventory.stateId ?? 0,
          items: snapshot.inventory.items.map((item) => toNotch(Item, item)),
          carriedItem: toNotch(Item, snapshot.inventory.cursor ?? null),
        },
        inventoryFields,
      ),
    };

    if (snapshot.inventory.window && packetExists(this.data, 'open_window')) {
      const window = snapshot.inventory.window;
      yield {
        phase: 'play',
        name: 'open_window',
        data: supported(
          {
            windowId: window.id,
            inventoryType: window.type,
            windowTitle: window.title,
            slotCount: window.slots.length,
          },
          packetFields(this.data, 'open_window'),
        ),
      };
      yield {
        phase: 'play',
        name: 'window_items',
        data: supported(
          {
            windowId: window.id,
            stateId: window.stateId ?? 0,
            items: window.slots.map((item) => toNotch(Item, item)),
            carriedItem: toNotch(Item, snapshot.inventory.cursor ?? null),
          },
          inventoryFields,
        ),
      };
    }

    if (snapshot.player.abilities && packetExists(this.data, 'abilities'))
      yield {
        phase: 'play',
        name: 'abilities',
        data: snapshot.player.abilities,
      };
    yield {
      phase: 'play',
      name: 'update_health',
      data: supported(
        {
          health: snapshot.player.health,
          food: snapshot.player.food,
          foodSaturation: snapshot.player.foodSaturation,
        },
        packetFields(this.data, 'update_health'),
      ),
    };
    if (packetExists(this.data, 'experience'))
      yield {
        phase: 'play',
        name: 'experience',
        data: {
          experienceBar: snapshot.player.experienceBar,
          level: snapshot.player.experienceLevel,
          totalExperience: snapshot.player.totalExperience,
        },
      };
    if (packetExists(this.data, 'held_item_slot'))
      yield {
        phase: 'play',
        name: 'held_item_slot',
        data: supported(
          { slotId: snapshot.player.selectedSlot },
          packetFields(this.data, 'held_item_slot'),
        ),
      };
  }

  /** The packets that recreate the provider's world on a client that already has its login. */
  *compile(snapshot: ProxyStateSnapshot): Generator<CompiledStatePacket> {
    this.#validate(snapshot);
    yield* this.#bootstrap(snapshot);
    const batched = packetExists(this.data, 'chunk_batch_start');
    if (batched) yield { phase: 'play', name: 'chunk_batch_start', data: {} };
    for (const chunk of snapshot.world.chunks) yield* this.#chunk(chunk, snapshot);
    if (batched)
      yield {
        phase: 'play',
        name: 'chunk_batch_finished',
        data: supported(
          { batchSize: snapshot.world.chunks.length },
          packetFields(this.data, 'chunk_batch_finished'),
        ),
      };
    for (const entity of snapshot.entities ?? []) yield* this.#entity(entity);
    yield* this.#tail(snapshot);
  }
}
