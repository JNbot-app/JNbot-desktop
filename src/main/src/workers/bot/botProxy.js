// Proxy-specific bot state. This is deliberately separate from botActions:
// normal bots do not retain a second world model unless a switching proxy asks.
const CONTROL_CHANNEL = 'jnbot:proxy';

const providers = new Map();

let conv;
try {
  conv = require('mineflayer/lib/conversions');
} catch {
  const PI = Math.PI;
  const PI_2 = Math.PI * 2;
  const TO_RAD = PI / 180;
  const TO_DEG = 1 / TO_RAD;
  const euclideanMod = (n, m) => ((n % m) + m) % m;
  conv = {
    toRadians: (degrees) => TO_RAD * degrees,
    toDegrees: (radians) => TO_DEG * radians,
    fromNotchianYaw: (yaw) => euclideanMod(PI - TO_RAD * yaw, PI_2),
    fromNotchianPitch: (pitch) => euclideanMod(TO_RAD * -pitch + PI, PI_2) - PI,
    toNotchianYaw: (yaw) => TO_DEG * (PI - yaw),
    toNotchianPitch: (pitch) => TO_DEG * -pitch,
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function providerFor(bot) {
  return {
    status: () => bot.proxyStateStatus(),
    capture: () => bot.exportProxyState(),
  };
}

function getBotStateProvider(botId) {
  return providers.get(Number(botId));
}

/** Play packets with session-wide state; a joining client gets the latest copy of each. */
const SINGLETONS = new Set([
  'difficulty',
  'spawn_position',
  'server_data',
  'declare_commands',
  'initialize_world_border',
  'update_time',
  'tags',
]);
const RAW_PLAY = new Set(['login', 'respawn', ...SINGLETONS]);
const RAW = Symbol('proxyRaw');

/**
 * Keep the wire bytes of configuration packets and of RAW_PLAY packets, so a
 * client joining the proxy session can be replayed exactly what the server
 * sent, whatever the protocol version.
 */
function keepRawPackets(client) {
  const patch = () => {
    const deserializer = client.deserializer;
    if (!deserializer || deserializer[RAW]) return;
    deserializer[RAW] = true;
    const { state } = client;
    const parse = deserializer.parsePacketBuffer.bind(deserializer);
    deserializer.parsePacketBuffer = (buffer) => {
      const packet = parse(buffer);
      if (state === 'configuration' || RAW_PLAY.has(packet?.data?.name))
        packet.fullBuffer = Buffer.from(buffer);
      return packet;
    };
  };
  patch();
  client.on('state', patch);
}

function inject(bot) {
  let enabled = false;
  let nonce;
  let trackerAnnounced = false;
  const hasConfiguration = () => bot.supportFeature?.('hasConfigurationState');
  const handshake = {
    configuration: [],
    configurationComplete: false,
    login: undefined,
    respawn: undefined,
    singletons: new Map(),
  };
  const state = {
    viewDistance: undefined,
    abilities: undefined,
    teleportId: undefined,
    inventoryStateId: undefined,
    mirroredPlayer: undefined,
    chunkHeightmaps: new Map(),
  };

  const sendControl = (message) => {
    bot._client.write('custom_payload', {
      channel: CONTROL_CHANNEL,
      data: Buffer.from(JSON.stringify(message)),
    });
  };

  const announceTrackerReady = () => {
    if (!enabled || trackerAnnounced || !proxyStateStatus().ready) return;
    trackerAnnounced = true;
    sendControl({ type: 'state_ready', nonce, botId: bot.botId });
  };

  const activate = (message) => {
    if (enabled) return;
    if (message?.type !== 'enable' || typeof message.nonce !== 'string') return;
    enabled = true;
    nonce = message.nonce;
    providers.set(Number(bot.botId), providerFor(bot));
    sendControl({
      type: 'ready',
      nonce,
      botId: bot.botId,
      token: bot.proxyControlToken,
    });
    announceTrackerReady();
  };

  const syncMirroredPlayer = (player) => {
    if (!player || typeof player !== 'object') return;
    const previous = state.mirroredPlayer ?? {};
    const previousPos = previous.position ?? {};
    const incomingPos = player.position ?? {};
    const position = {
      ...previousPos,
      ...incomingPos,
    };
    state.mirroredPlayer = { ...previous, ...player, position };

    if (position && bot.entity?.position) {
      if (typeof bot.entity.position.set === 'function') {
        bot.entity.position.set(position.x, position.y, position.z);
      } else {
        Object.assign(bot.entity.position, {
          x: position.x,
          y: position.y,
          z: position.z,
        });
      }
      if (typeof position.onGround === 'boolean') {
        bot.entity.onGround = position.onGround;
      }
      if (bot.entity.velocity) {
        if (typeof bot.entity.velocity.set === 'function') {
          bot.entity.velocity.set(0, 0, 0);
        } else {
          bot.entity.velocity.x = 0;
          bot.entity.velocity.y = 0;
          bot.entity.velocity.z = 0;
        }
      }
    }

    if (
      typeof position?.yaw === 'number' ||
      typeof position?.pitch === 'number'
    ) {
      const yaw =
        typeof position?.yaw === 'number'
          ? conv.fromNotchianYaw(position.yaw)
          : (bot.entity.yaw ?? 0);
      const pitch =
        typeof position?.pitch === 'number'
          ? conv.fromNotchianPitch(position.pitch)
          : (bot.entity.pitch ?? 0);
      if (typeof bot.look === 'function') {
        bot.look(yaw, pitch, true).catch(() => {});
      }
      bot.entity.yaw = yaw;
      bot.entity.headYaw = yaw;
      bot.entity.pitch = pitch;
    }

    if (Number.isInteger(player.selectedSlot)) {
      bot.quickBarSlot = player.selectedSlot;
    }
  };

  bot._client.on('custom_payload', (packet) => {
    if (packet?.channel !== CONTROL_CHANNEL || !packet.data) return;
    let message;
    try {
      message = JSON.parse(Buffer.from(packet.data).toString('utf8'));
    } catch {
      return;
    }
    if (!enabled) return activate(message);
    if (message?.nonce !== nonce || message.botId !== bot.botId) return;
    // Handled in packet order, so the reply proves earlier packets were applied.
    if (message.type === 'barrier')
      sendControl({ type: 'barrier', nonce, botId: bot.botId, id: message.id });
    if (message.type === 'state_sync') syncMirroredPlayer(message.player);
    if (message.type === 'freeze') {
      bot.physicsEnabled = false;
      if (bot.physics) bot.physics.enabled = false;
      bot.clearControlStates?.();
      if (bot.entity?.velocity) {
        if (typeof bot.entity.velocity.set === 'function') {
          bot.entity.velocity.set(0, 0, 0);
        } else {
          bot.entity.velocity.x = 0;
          bot.entity.velocity.y = 0;
          bot.entity.velocity.z = 0;
        }
      }
    }
    if (message.type === 'resume') {
      if (message.player) {
        syncMirroredPlayer(message.player);
      } else if (state.mirroredPlayer?.position && bot.entity?.position) {
        syncMirroredPlayer(state.mirroredPlayer);
      }
      bot.physicsEnabled = true;
      if (bot.physics) bot.physics.enabled = true;
      bot.clearControlStates?.();
      if (bot.entity?.velocity) {
        if (typeof bot.entity.velocity.set === 'function') {
          bot.entity.velocity.set(0, 0, 0);
        } else {
          bot.entity.velocity.x = 0;
          bot.entity.velocity.y = 0;
          bot.entity.velocity.z = 0;
        }
      }
      sendControl({ type: 'resumed', nonce, botId: bot.botId });
    }
  });
  bot.once('end', () => providers.delete(Number(bot.botId)));

  keepRawPackets(bot._client);
  bot._client.on('packet', (data, meta, _buffer, raw) => {
    if (meta.state === 'configuration') {
      if (meta.name === 'finish_configuration') {
        handshake.configurationComplete = true;
        announceTrackerReady();
      } else if (raw && meta.name !== 'keep_alive' && meta.name !== 'ping') {
        handshake.configuration.push(raw);
      }
      return;
    }
    if (meta.name === 'start_configuration') {
      handshake.configuration = [];
      handshake.configurationComplete = false;
      handshake.singletons.clear();
      state.chunkHeightmaps.clear();
      trackerAnnounced = false;
      if (enabled) sendControl({ type: 'state_reset', nonce, botId: bot.botId });
      return;
    }
    // Every packet carries `raw`, but only these were copied by keepRawPackets.
    if (!RAW_PLAY.has(meta.name)) return;
    if (meta.name === 'login') {
      handshake.login = raw;
      handshake.respawn = undefined;
      state.viewDistance = data.viewDistance;
      announceTrackerReady();
    } else if (meta.name === 'respawn') {
      handshake.respawn = raw;
      state.chunkHeightmaps.clear();
    } else {
      handshake.singletons.set(meta.name, raw);
    }
  });
  bot._client.on('map_chunk', (packet) => {
    if (packet?.x !== undefined && packet?.z !== undefined)
      state.chunkHeightmaps.set(
        `${packet.x},${packet.z}`,
        clone(packet.heightmaps),
      );
  });
  bot._client.on('abilities', (packet) => {
    state.abilities = clone(packet);
  });
  bot._client.on('position', (packet) => {
    if (typeof packet?.teleportId === 'number')
      state.teleportId = packet.teleportId;
    announceTrackerReady();
  });
  for (const name of ['window_items', 'set_slot'])
    bot._client.on(name, (packet) => {
      if (typeof packet?.stateId === 'number')
        state.inventoryStateId = packet.stateId;
      announceTrackerReady();
    });
  bot.on('spawn', announceTrackerReady);

  function proxyStateStatus() {
    const reasons = [];
    if (!enabled) reasons.push('The bot is not connected to a switching proxy');
    if (!handshake.login) reasons.push('The bot has not joined a world');
    if (!bot.entity?.position) reasons.push('The bot has not spawned');
    if (!Array.isArray(bot.inventory?.slots))
      reasons.push('The bot inventory is unavailable');
    if (hasConfiguration() && !handshake.configurationComplete)
      reasons.push('The bot has not finished configuration');
    return { ready: reasons.length === 0, reasons };
  }

  function exportProxyState() {
    const status = proxyStateStatus();
    if (!status.ready) throw new Error(status.reasons.join('. '));
    const position = state.mirroredPlayer?.position ?? bot.entity.position;
    let yaw = 0;
    let pitch = 0;
    if (typeof position.yaw === 'number') {
      yaw = position.yaw;
      pitch = Number(position.pitch ?? 0);
    } else {
      yaw = conv.toNotchianYaw(bot.entity.yaw ?? 0);
      pitch = conv.toNotchianPitch(bot.entity.pitch ?? 0);
    }
    const window = bot.currentWindow;
    return {
      protocol: bot.protocolVersion ?? bot._client?.protocolVersion ?? 47,
      handshake: {
        configuration: [...handshake.configuration],
        login: handshake.login,
        respawn: handshake.respawn,
        singletons: [...handshake.singletons.values()],
      },
      game: {
        viewDistance: state.viewDistance,
        dimension: {
          name: bot.game?.dimension,
          minY: Number(bot.game?.minY ?? 0),
          height: Number(bot.game?.height ?? 256),
        },
      },
      player: {
        position: {
          x: Number(position.x),
          y: Number(position.y),
          z: Number(position.z),
          yaw,
          pitch,
        },
        health: Number(bot.health ?? 20),
        food: Number(bot.food ?? 20),
        foodSaturation: Number(bot.foodSaturation ?? 5),
        experienceBar: Number(bot.experience?.progress ?? 0),
        experienceLevel: Number(bot.experience?.level ?? 0),
        totalExperience: Number(bot.experience?.points ?? 0),
        selectedSlot: Number(
          state.mirroredPlayer?.selectedSlot ?? bot.quickBarSlot ?? 0,
        ),
        abilities: clone(state.abilities),
      },
      world: { chunks: exportChunks() },
      entities: exportEntities(),
      inventory: {
        items: clone(bot.inventory.slots),
        stateId: state.inventoryStateId,
        cursor: clone(window?.selectedItem ?? null),
        window: window
          ? {
              id: window.id,
              type: window.type,
              title: clone(window.title),
              slots: clone(window.slots),
              stateId: state.inventoryStateId,
            }
          : undefined,
      },
      synchronization: { teleportId: state.teleportId },
    };
  }

  function exportChunks() {
    const columns =
      bot.world?.getColumns?.() ?? bot.world?.async?.getColumns?.() ?? [];
    return columns
      .filter((entry) => entry?.column?.toJson)
      .map((entry) => ({
        x: Number(entry.chunkX),
        z: Number(entry.chunkZ),
        column: entry.column.toJson(),
        heightmaps: clone(
          state.chunkHeightmaps.get(`${entry.chunkX},${entry.chunkZ}`),
        ),
      }));
  }

  function exportEntities() {
    return Object.values(bot.entities ?? {})
      .filter((entity) => entity && entity.id !== bot.entity?.id)
      .map((entity) => ({
        id: entity.id,
        uuid: entity.uuid,
        type: entity.entityType ?? entity.type,
        name: entity.name,
        position: {
          x: Number(entity.position?.x ?? 0),
          y: Number(entity.position?.y ?? 0),
          z: Number(entity.position?.z ?? 0),
          yaw: entity.yaw,
          pitch: entity.pitch,
          headYaw: entity.headYaw,
        },
        velocity: entity.velocity
          ? {
              x: Number(entity.velocity.x ?? 0),
              y: Number(entity.velocity.y ?? 0),
              z: Number(entity.velocity.z ?? 0),
            }
          : undefined,
        metadata: clone(entity.metadata),
        attributes: clone(entity.attributes),
        equipment: Array.isArray(entity.equipment)
          ? entity.equipment.map((item, slot) => ({ slot, item: clone(item) }))
          : undefined,
      }));
  }

  bot.proxyStateStatus = proxyStateStatus;
  bot.exportProxyState = exportProxyState;
  // BotMessenger is action-only. botActions runs before this plugin and owns
  // the public action map, so extend it instead of replacing it.
  bot.actions = { ...(bot.actions ?? {}), exportProxyState };
}

module.exports = inject;
module.exports.getBotStateProvider = getBotStateProvider;
module.exports.CONTROL_CHANNEL = CONTROL_CHANNEL;
