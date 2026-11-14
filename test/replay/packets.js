/**
 * Which client packets are compared, and what of them. Every tick, the labels
 * of the client's compared packets must equal the bot's, in the same order.
 *
 * `BY_NAME` packets are compared by kind. A rule returns the label of the
 * others: the details that must match (block, face, hand, target). Leave out
 * what legitimately differs between two clients, like sequence numbers.
 * Packets in neither are not compared: the ones a
 * vanilla client sends from the render thread (window clicks, closing screens,
 * chat) are not tied to the tick.
 */
const MOVES = new Set(['flying', 'position', 'look', 'position_look']);
const DIG = ['start', 'abort', 'stop', 'drop_stack', 'drop', 'release_use', 'swap_hands'];
const FACES = ['down', 'up', 'north', 'south', 'west', 'east'];
const USE_ENTITY = ['interact', 'attack', 'interact_at'];
const LEGACY_ACTIONS = { 0: 'start_sneaking', 1: 'stop_sneaking', 3: 'start_sprinting', 4: 'stop_sprinting' };

const xyz = (p) => `${p.x},${p.y},${p.z}`;
const off = (p) => (p.hand === 1 ? ' off' : '');
const cursor = (p) => [p.cursorX, p.cursorY, p.cursorZ].map((n) => Number(n).toFixed(2)).join(',');

const entityAction = (p) => (typeof p?.actionId === 'string' ? p.actionId : LEGACY_ACTIONS[p?.actionId]);

/** Compared by kind only. */
const BY_NAME = new Set([
  ...MOVES, 'tick_end', 'teleport_confirm', 'player_loaded', 'abilities',
  'steer_vehicle', 'vehicle_move', 'steer_boat', // vehicles
]);

/** packet name → label(params) */
const RULES = {
  entity_action: (p) => `entity_action:${entityAction(p) ?? p.actionId}`,
  // The sprint bit is the key, not the state: toggle/double-tap sprinting leaves it off, so it isn't compared.
  player_input: (p) =>
    `player_input:${['forward', 'backward', 'left', 'right', 'jump', 'shift'].filter((k) => p.inputs?.[k]).join('+') || 'none'}`,
  // Mouse and hotbar
  held_item_slot: (p) => `hotbar:${p.slotId}`,
  arm_animation: (p) => `swing${off(p)}`,
  block_dig: (p) => `dig:${DIG[p.status] ?? p.status}${p.status <= 2 ? ` ${xyz(p.location)} ${FACES[p.face] ?? p.face}` : ''}`,
  use_entity: (p) => `${USE_ENTITY[p.mouse] ?? p.mouse} #${p.target}${off(p)}`,
  block_place: (p) => `use_on ${xyz(p.location)} ${FACES[p.direction] ?? p.direction} @${cursor(p)}${off(p)}`,
  use_item: (p) => `use_item${off(p)}`,
};

const labelOf = (packet) => (BY_NAME.has(packet.name) ? packet.name : RULES[packet.name]?.(packet.params ?? {}));

/**
 * Labels of the compared packets. A player_input that only changed the
 * (uncompared) sprint key is left out; `last` keeps the previous one per side.
 */
function labels(packets, last, side) {
  const out = [];
  for (const packet of packets) {
    const label = labelOf(packet);
    if (label === undefined) continue;
    if (packet.name === 'player_input') {
      if (last[side] === label) continue;
      last[side] = label;
    }
    out.push(label);
  }
  return out;
}

module.exports = { BY_NAME, RULES, MOVES, labels, entityAction };
