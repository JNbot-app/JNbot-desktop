/**
 * Builds a synthetic recording in the proxy Recorder's on-disk format: the
 * engine itself plays the client on a small flat world with a wall, following
 * a scripted input course (walk, sprint, jump, strafe, turn, sneak, collide,
 * idle, knockback, teleport, then mining, clicking and the hotbar) split into
 * two tasks.
 *
 * Replaying it against the same engine must give zero mismatches, so it tests
 * the harness itself (decoding, tick grouping, input inference, timing) for
 * every boundary mode without needing a real client.
 */
const fs = require('fs');
const path = require('path');
const minecraftData = require('minecraft-data');
const { createSerializer, createDeserializer } = require('minecraft-protocol');
const { Vec3 } = require('vec3');
const { createMineflayerEngine } = require('./engines/mineflayer');
const { TASK_MARKER } = require('./recording');

const ENTITY_ID = 1234;
const FLOOR_Y = 63;
const WALL_Z = 24;
const SPAWN = { x: 8.5, y: 66, z: 8.5 };

/** Scripted input per tick range: [until tick, input]. */
const COURSE = [
  [20, {}],
  [60, { forward: true }],
  [90, { forward: true, sprint: true, jump: true }],
  [110, { left: true, yawStep: 4 }],
  [130, { forward: true, sneak: true }],
  [170, { forward: true, yaw: 0 }], // into the wall
  [200, {}],
  [230, { back: true, right: true, jump: true, yawStep: -3, pitch: 20 }],
  [260, { forward: true, sprint: true }],
  [262, {}],
  [292, { pitch: 90, mouse: { left: 'hold' } }], // mine the stone floor by hand: start, a swing every tick
  [295, { pitch: 90 }], // released before it breaks: abort
  [296, { pitch: 90, mouse: { right: 'click' } }], // right click it with an empty hand
  [300, { pitch: 90 }],
  [301, { pitch: -90, mouse: { left: 'click' } }], // swing at the sky
  [302, { pitch: -90, hotbar: 3 }],
  [310, {}],
];
/** Task markers: [tick, action, name] (ticks 0, 261 and 309 are outside every task). */
const TASKS = [
  [1, 'start', 'move'],
  [261, 'end', 'move'],
  [262, 'start', 'mouse'],
  [309, 'end', 'mouse'],
];
/** Server events: tick → packets (built per version). */
const EVENTS = {
  95: (data) => [['entity_velocity', velocityPacket(data)]],
  205: (data) => [['position', teleportPacket(data, { x: 4.5, y: 64, z: 4.5 }, 2)]],
};

function fieldsOf(data, name) {
  const type = data.protocol.play.toClient.types[`packet_${name}`];
  return new Set(type?.[1]?.map((f) => f.name) ?? []);
}

const only = (fields, params) => Object.fromEntries(Object.entries(params).filter(([k, v]) => v !== undefined && fields.has(k)));

function loginPacket(data) {
  const fields = fieldsOf(data, 'login');
  if (data.loginPacket) return { ...data.loginPacket, entityId: ENTITY_ID };
  return only(fields, {
    entityId: ENTITY_ID,
    gameMode: 0,
    dimension: 0,
    difficulty: 0,
    maxPlayers: 20,
    levelType: 'flat',
    reducedDebugInfo: false,
  });
}

function teleportPacket(data, pos, teleportId = 1) {
  return only(fieldsOf(data, 'position'), {
    ...pos,
    yaw: 0,
    pitch: 0,
    flags: data.version['>=']('1.21.2') ? {} : 0,
    teleportId,
    dx: 0,
    dy: 0,
    dz: 0,
  });
}

function velocityPacket(data) {
  const fields = fieldsOf(data, 'entity_velocity');
  // 1.21.9+ sends a low precision vector, older versions 1/8000 block units.
  if (fields.has('velocity')) return { entityId: ENTITY_ID, velocity: { x: 0.3, y: 0.4, z: -0.2 } };
  return { entityId: ENTITY_ID, velocityX: 2400, velocityY: 3200, velocityZ: -1600 };
}

/** Configuration-phase registries (1.20.2+), taken from minecraft-data's sample login. */
function configurationPackets(data) {
  if (!data.protocol.configuration) return [];
  const codec = data.loginPacket.dimensionCodec;
  // 1.20.2 – 1.20.4 send one codec, 1.20.5+ one packet per registry.
  const registries = data.version['>=']('1.20.5') ? Object.values(codec) : [{ codec }];
  return [...registries.map((registry) => ['registry_data', registry]), ['finish_configuration', {}]];
}

function chunkPackets(data) {
  const registry = require('prismarine-registry')(data.version.minecraftVersion);
  const Chunk = require('prismarine-chunk')(registry);
  const fields = fieldsOf(data, 'map_chunk');
  const stone = registry.blocksByName.stone;
  const heightmapType = JSON.stringify(data.protocol.play.toClient.types.packet_map_chunk).includes('"heightmaps","type":["array"');
  const packets = [];
  for (let cx = -2; cx <= 2; cx++)
    for (let cz = -2; cz <= 2; cz++) {
      const column = data.version['>=']('1.18') ? new Chunk({ minY: -64, worldHeight: 384 }) : new Chunk();
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++) {
          column.setBlockStateId(new Vec3(x, FLOOR_Y, z), stone.defaultState ?? stone.minStateId);
          if (cz * 16 + z === WALL_Z)
            for (let y = FLOOR_Y + 1; y <= FLOOR_Y + 3; y++) column.setBlockStateId(new Vec3(x, y, z), stone.defaultState ?? stone.minStateId);
        }
      packets.push([
        'map_chunk',
        only(fields, {
          x: cx,
          z: cz,
          groundUp: true,
          bitMap: column.getMask?.(),
          biomes: column.dumpBiomes?.(),
          heightmaps: heightmapType ? [] : { type: 'compound', name: '', value: {} },
          chunkData: column.dump(),
          blockEntities: [],
          ...(column.dumpLight?.() ?? {}),
        }),
      ]);
    }
  return packets;
}

/** The engine input for a tick; `held` carries which buttons were held the tick before. */
function inputAt(tick, look, held) {
  const [, step] = COURSE.find(([until]) => tick < until) ?? [0, {}];
  if (step.yaw !== undefined) look.yaw = step.yaw;
  if (step.yawStep) look.yaw += step.yawStep;
  if (step.pitch !== undefined) look.pitch = step.pitch;
  const mouse = {};
  for (const button of ['left', 'right']) {
    const action = step.mouse?.[button];
    mouse[button] = { held: action === 'hold', presses: action === 'click' || (action === 'hold' && !held[button]) ? 1 : 0 };
    held[button] = action === 'hold';
  }
  return { ...step, mouse, yaw: look.yaw, pitch: look.pitch };
}

/** Writes `<dir>/<name>.json` + `.log` and returns the base path. */
function writeSyntheticRecording(version, dir, name = `synthetic-${version}`) {
  const data = minecraftData(version);
  const codecs = {};
  const codec = (state, dirn) =>
    (codecs[state + dirn] ??= {
      serializer: createSerializer({ state, version, isServer: dirn === 's2c' }),
      deserializer: createDeserializer({ state, version, isServer: dirn === 'c2s', noErrorLogging: true }),
    });
  const lines = [];
  /** Writes a packet like the Recorder does and returns it as a replay will decode it. */
  const record = (dirn, packetName, params, t, state = 'play') => {
    const { serializer, deserializer } = codec(state, dirn);
    const buffer = serializer.createPacketBuffer({ name: packetName, params });
    lines.push(JSON.stringify({ n: packetName, dt: Math.round(t), r: buffer.toString('base64'), m: { phase: state }, d: dirn }));
    return { name: packetName, params: deserializer.parsePacketBuffer(buffer).data.params, state };
  };

  const engine = createMineflayerEngine({ version });
  const clock = () => engine.bot._client.clock.now;
  try {
    const configuration = configurationPackets(data).map(([n, params]) => [n, params, 'configuration']);
    const join = [...configuration, ['login', loginPacket(data)], ...chunkPackets(data), ['update_health', { health: 20, food: 20, foodSaturation: 5 }], ['position', teleportPacket(data, SPAWN)]];
    const look = { yaw: 0, pitch: 0 };
    const held = {};
    const total = COURSE[COURSE.length - 1][0];
    for (let tick = 0; tick < total; tick++) {
      for (const [at, action, task] of TASKS)
        if (at === tick) lines.push(JSON.stringify({ n: TASK_MARKER, dt: clock(), p: { action, name: task }, m: { marker: true }, d: 'c2s' }));
      const incoming = tick === 0 ? join : (EVENTS[tick]?.(data) ?? []);
      engine.receive(incoming.map(([n, params, state]) => record('s2c', n, params, clock(), state)));
      engine.applyInput(inputAt(tick, look, held));
      engine.step();
      // A vanilla client sends everything at its tick (the engine replies to teleports earlier).
      for (const packet of engine.takeSent()) record('c2s', packet.name, packet.params, clock(), packet.state);
    }
    if (engine.errors.length) throw engine.errors[0];
  } finally {
    engine.close();
  }

  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, name);
  fs.writeFileSync(`${base}.log`, lines.join('\n') + '\n');
  fs.writeFileSync(`${base}.json`, JSON.stringify({ id: name, name, kind: 'debug', version: 'synthetic', timestamp: 0, mcVersion: version, packetCount: lines.length }));
  return base;
}

module.exports = { writeSyntheticRecording };
