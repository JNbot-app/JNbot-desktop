/**
 * Splits a recording into client ticks.
 *
 * Tick boundaries, best source first:
 *  - `tick_end` (1.21.2+): the client marks the end of every tick.
 *  - 1.8: the client sends one movement packet every tick.
 *  - 1.9 – 1.21.1: one movement packet per tick while moving; idle ticks send
 *    nothing, so gaps are filled with idle ticks estimated from timestamps.
 *
 * Server packets belong to the first tick whose first client packet comes
 * after them: the client handles incoming packets at the start of its tick.
 * Teleports are exact: the n-th one is handled in the tick of the n-th
 * teleport_confirm (a frozen client handles them late, a busy one mid-burst);
 * other packets keep their order around them.
 * The reply to a teleport (teleport_confirm + position_look) is sent while
 * handling the packet, so it never ends a tick.
 *
 * Tasks become tick ranges: the whole ticks between their markers.
 */
const minecraftData = require('minecraft-data');
const { MOVES } = require('./packets');
const { addInputs } = require('./inputs');

const TICK_MS = 50;
/** Client packets the network thread sends outside of the tick. */
const OFF_TICK = new Set(['keep_alive', 'pong', 'ping_request', 'custom_payload', 'chunk_batch_received', 'configuration_acknowledged']);
/** In timestamp mode, client packets this far apart belong to different ticks. */
const SAME_TICK_MS = 35;

function movementOf(packet) {
  const p = packet.params ?? {};
  const move = { onGround: p.onGround ?? p.flags?.onGround };
  if (packet.name === 'position' || packet.name === 'position_look') Object.assign(move, { x: p.x, y: p.y, z: p.z });
  if (packet.name === 'look' || packet.name === 'position_look') Object.assign(move, { yaw: p.yaw, pitch: p.pitch });
  if (p.flags?.hasHorizontalCollision !== undefined) move.horizontalCollision = p.flags.hasHorizontalCollision;
  return move;
}

function buildTimeline(recording) {
  const data = minecraftData(recording.version);
  if (!data) throw new Error(`Unsupported Minecraft version ${recording.version}`);
  const packets = recording.packets.filter((p) => !p.failure);
  const confirms = packets.some((p) => p.dir === 'c2s' && p.name === 'teleport_confirm');
  const keysKnown = Boolean(data.supportFeature('newPlayerInputPacket'));
  const mode = packets.some((p) => p.dir === 'c2s' && p.name === 'tick_end')
    ? 'tick_end'
    : data.supportFeature('positionUpdateSentEveryTick')
      ? 'every_tick'
      : 'timed';

  // 1. Group client packets into ticks.
  const groups = [];
  const arrivals = []; // server packets with the tick that handles them
  const confirmTicks = [];
  let open = null;
  let teleportReplies = 0;
  let previous;
  for (const packet of packets) {
    if (packet.dir === 's2c') {
      if (packet.name === 'position' && packet.state === 'play') teleportReplies++;
      arrivals.push({ packet, tick: groups.length });
      continue;
    }
    if (packet.state !== 'play' || OFF_TICK.has(packet.name)) continue;
    // A client sends a tick's packets together; a teleport reply alone was its own tick.
    if (open && mode === 'timed' && packet.t - open.t >= SAME_TICK_MS) open = null;
    if (!open) {
      open = { t: packet.t, s2c: [], c2s: [], move: null };
      groups.push(open);
    }
    open.c2s.push(packet);
    open.t = packet.t;
    if (packet.name === 'teleport_confirm') confirmTicks.push(groups.length - 1);
    let closes = mode === 'tick_end' && packet.name === 'tick_end';
    if (MOVES.has(packet.name)) {
      // 1.9+: the reply directly follows its teleport_confirm. 1.8: the first move after a teleport.
      const reply = confirms ? previous?.name === 'teleport_confirm' : teleportReplies > 0;
      if (reply && packet.name === 'position_look') {
        packet.teleportReply = true;
        teleportReplies--;
      } else {
        open.move = movementOf(packet);
        if (mode !== 'tick_end') closes = true;
      }
    }
    if (closes) open = null;
    previous = packet;
  }

  // Teleports go to their confirm's tick; the rest stay in order around them.
  const fixed = (a) => a.confirmed;
  let n = 0;
  for (const a of arrivals)
    if (a.packet.name === 'position' && a.packet.state === 'play' && n < confirmTicks.length) {
      a.tick = confirmTicks[n++];
      a.confirmed = true;
    }
  for (let i = arrivals.length - 2; i >= 0; i--) if (!fixed(arrivals[i])) arrivals[i].tick = Math.min(arrivals[i].tick, arrivals[i + 1].tick);
  for (let i = 1; i < arrivals.length; i++) if (!fixed(arrivals[i])) arrivals[i].tick = Math.max(arrivals[i].tick, arrivals[i - 1].tick);
  for (const a of arrivals) groups[a.tick]?.s2c.push(a.packet);

  // 2. Timestamps only: fill idle gaps, spreading server packets by arrival time.
  let ticks = groups;
  if (mode === 'timed') {
    ticks = [];
    let prev;
    for (const group of groups) {
      const gap = prev ? Math.max(1, Math.round((group.t - prev.t) / TICK_MS)) : 1;
      const idle = Array.from({ length: gap - 1 }, (_, j) => ({
        t: prev.t + (j + 1) * TICK_MS,
        s2c: [],
        c2s: [],
        move: null,
        idle: true,
      }));
      const own = [];
      for (const packet of group.s2c) {
        const j = prev ? Math.ceil((packet.t - prev.t) / TICK_MS) : gap;
        (j >= 1 && j < gap ? idle[j - 1].s2c : own).push(packet);
      }
      ticks.push(...idle, { ...group, s2c: own });
      prev = group;
    }
  }

  ticks.forEach((tick, index) => (tick.index = index));
  addInputs(ticks);
  return { mode, keysKnown, ticks, tasks: taskRanges(recording, ticks) };
}

/**
 * Tick range of each task: the ticks whose client packets all come after its
 * start marker and before its end marker. Without markers, one task covers
 * the whole recording.
 */
function taskRanges(recording, ticks) {
  if (!recording.tasks?.length) return [{ name: 'all', from: 0, to: ticks.length - 1 }];
  return recording.tasks.map(({ name, start, end }) => {
    let from = 0;
    ticks.forEach((tick, index) => tick.c2s.some((p) => p.i < start) && (from = index + 1));
    const after = ticks.findIndex((tick) => tick.c2s.some((p) => p.i >= end));
    return { name, from, to: after < 0 ? ticks.length - 1 : after - 1 };
  });

}

module.exports = { buildTimeline, TICK_MS };
