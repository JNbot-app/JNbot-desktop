/**
 * What the player did in each tick, read from the client's packets. Engines
 * apply it with `applyInput` before running the tick:
 *
 *   forward back left right jump sprint sneak   keys (direction keys only on 1.21.2+, see inferKeys.js)
 *   yaw pitch                                   look, as reported by the tick's move packet
 *   flying                                      creative/allowed flight
 *   hotbar                                      slot the client selected this tick
 *   closeWindow                                 window id the client closed this tick
 *   mouse.left / mouse.right                    { held, presses }: held during the tick, new presses
 *   mouse.target                                what the crosshair was on, when the packets tell:
 *                                               { block: 'x,y,z' }, { entity: id }, { none }, { keep } (unchanged)
 *
 * The mouse is not on the wire, so it is inferred from what a vanilla client
 * sends for it (Minecraft#handleKeybinds, mirrored by mouseExtension):
 *  - left:  every tick it is held on a block the client mines or swings, so it
 *           is held while it digs, attacks or swings. A press is the first such
 *           tick, or each attack (one per click). START and ABORT in one tick is
 *           a click shorter than a tick.
 *  - right: a click uses the item or block once; holding repeats every 4 ticks,
 *           or keeps using an item (eating, a bow) until released
 *           (RELEASE_USE_ITEM) or finished (entity_status 9).
 *
 * Adding a new kind of input: read it from `tick.c2s` here, apply it in the
 * engine's applyInput, and add its packets to packets.js so they are compared.
 */
const { MOVES, entityAction } = require('./packets');

const DIG = { START: 0, ABORT: 1, STOP: 2, RELEASE_USE: 5 };
const USE_REPEAT = 4; // ticks between uses while right is held
const MAX_USE = 1200; // longest item use searched for its release
const MAX_AIMLESS = 200; // longest the left button is assumed held while aimed at nothing
const FINISHED_USING_ITEM = 9; // entity_status

const blockKey = (pos) => `${pos.x},${pos.y},${pos.z}`;

function lookOf(packet) {
  const p = packet.params ?? {};
  return packet.name === 'look' || packet.name === 'position_look' ? { yaw: p.yaw, pitch: p.pitch } : undefined;
}

/** What the client's packets in one tick say about its mouse. */
function mouseActivity(tick, playerId) {
  const a = { left: false, tap: false, attacks: 0, starts: 0, stops: 0, swings: 0, right: false, use: false, release: false, finished: false };
  const aimedAt = (target) => (a.target ??= target);
  for (const packet of tick.c2s) {
    const p = packet.params ?? {};
    if (packet.name === 'block_dig') {
      if (p.status === DIG.START || p.status === DIG.STOP) {
        a.left = true;
        aimedAt({ block: blockKey(p.location) });
      }
      if (p.status === DIG.START) a.starts++;
      if (p.status === DIG.STOP) a.stops++;
      if (p.status === DIG.ABORT && a.starts) a.tap = true;
      if (p.status === DIG.RELEASE_USE) a.release = true;
    } else if (packet.name === 'use_entity') {
      aimedAt({ entity: p.target });
      if (p.mouse === 1) {
        a.left = true;
        a.attacks++;
      } else a.right = true;
    } else if (packet.name === 'block_place' || packet.name === 'use_item') {
      if (packet.name === 'block_place') aimedAt({ block: blockKey(p.location) });
      a.right = true;
      if (packet.name === 'use_item') a.use = true;
    } else if (packet.name === 'arm_animation') {
      if (p.hand === 1) a.right = true;
      else a.swings++;
    }
  }
  // A right click swings the main hand too; a lone swing is a left click at air.
  if (a.swings && (a.left || !a.right)) a.left = true;
  a.finished = tick.s2c.some((p) => p.name === 'entity_status' && p.params?.entityStatus === FINISHED_USING_ITEM && p.params?.entityId === playerId);
  return a;
}

/**
 * Whether left activity after ticks without any was the button still held
 * (aimed at nothing in between) rather than a new click. A click attacks, or
 * starts mining and swings twice (startAttack, then continueAttack); a held
 * button resumes the block it mined before without a new START (vanilla keeps
 * that target after an abort), or swings once with its START when it reaches
 * a block that takes more than one tick to mine.
 */
function continuesHold(a, next) {
  if (a.attacks || a.tap) return false;
  if (a.stops) return true;
  const nextContinues = Boolean(next?.left && !next.starts && !next.attacks);
  if (!a.starts) return a.swings > 0 && nextContinues; // a click at air is followed by the 10 tick miss delay
  return a.starts === 1 && a.swings === 1;
}

function inferMouse(ticks, playerIds) {
  const acts = ticks.map((tick, i) => mouseActivity(tick, playerIds[i]));
  const rightHeld = acts.map((a) => a.right);
  for (let u = 0; u < acts.length; u++) {
    if (!acts[u].right) continue;
    // Holding right repeats the click every 4 ticks.
    let next = u + 1;
    while (next < acts.length && !acts[next].right) next++;
    if (next - u === USE_REPEAT && !acts.slice(u + 1, next).some((a) => a.release)) rightHeld.fill(true, u, next);
    // Using an item (eating, drawing a bow) lasts until it is released or finished.
    if (!acts[u].use) continue;
    for (let k = u + 1; k < acts.length && k - u <= MAX_USE && !acts[k].right; k++)
      if (acts[k].release || acts[k].finished) {
        rightHeld.fill(true, u, k);
        break;
      }
  }
  const leftHeld = acts.map((a) => a.left && !a.tap);
  let lastLeft = -Infinity;
  acts.forEach((a, i) => {
    if (!a.left) return;
    if (i - lastLeft > 1 && i - lastLeft <= MAX_AIMLESS && continuesHold(a, acts[i + 1])) leftHeld.fill(true, lastLeft + 1, i);
    if (!a.tap) lastLeft = i;
  });
  ticks.forEach((tick, i) => {
    const a = acts[i];
    const left = { held: leftHeld[i], presses: a.attacks || (a.left && !(i > 0 && leftHeld[i - 1]) ? 1 : 0) };
    // A swing alone: a click at air, or held on the block it keeps mining.
    const target = a.target ?? (a.left && !a.right ? (left.presses ? { none: true } : { keep: true }) : undefined);
    tick.input.mouse = {
      left,
      right: { held: rightHeld[i], presses: a.right && !(i > 0 && rightHeld[i - 1]) ? 1 : 0 },
      target,
    };
  });
}

/** Sets `tick.input` on every tick. */
function addInputs(ticks) {
  const state = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false, flying: false };
  let playerId;
  const playerIds = ticks.map((tick) => {
    for (const p of tick.s2c) if (p.name === 'login') playerId = p.params?.entityId;
    const events = {};
    for (const packet of tick.c2s) {
      const p = packet.params ?? {};
      if (packet.name === 'player_input') {
        const i = p.inputs ?? {};
        Object.assign(state, { forward: !!i.forward, back: !!i.backward, left: !!i.left, right: !!i.right, jump: !!i.jump, sneak: !!i.shift });
      } else if (packet.name === 'entity_action') {
        const action = entityAction(p);
        if (action === 'start_sprinting' || action === 'stop_sprinting') state.sprint = action === 'start_sprinting';
        if (action === 'start_sneaking' || action === 'stop_sneaking') state.sneak = action === 'start_sneaking';
      } else if (packet.name === 'abilities') {
        state.flying = ((p.flags ?? 0) & 2) !== 0;
      } else if (MOVES.has(packet.name)) {
        Object.assign(state, lookOf(packet));
      } else if (packet.name === 'held_item_slot') {
        events.hotbar = p.slotId;
      } else if (packet.name === 'close_window') {
        events.closeWindow = p.windowId;
      }
    }
    tick.input = { ...state, ...events };
    return playerId;
  });
  inferMouse(ticks, playerIds);
}

module.exports = { addInputs };
