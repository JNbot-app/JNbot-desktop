/**
 * Before 1.21.2 the client never reports its direction keys, so they are
 * inferred: the keys (3 × 3 directions × jump; sprint, sneak and look as
 * reported) that end closest to the next reported position. Ticks in between
 * reported none, so the client stayed within the report distance of its last
 * report there. Tries one set of keys for the whole window, then a different
 * set for its last tick (e.g. stood still, then pressed W).
 */
const minecraftData = require('minecraft-data');

/** Farthest a client goes without reporting its position before inference gives up. */
const MAX_LOOKAHEAD = 100;
const DIRECTIONS = [];
for (const fb of [null, 'forward', 'back'])
  for (const lr of [null, 'left', 'right'])
    for (const jump of [false, true])
      DIRECTIONS.push({ forward: fb === 'forward', back: fb === 'back', left: lr === 'left', right: lr === 'right', jump });

/** A client reports its position once it moved this far from the last report (0.0002 since 1.18.2). */
const reportDistance = (version) => (minecraftData(version).version['>=']('1.18.2') ? 2e-4 : 0.03);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * @param anchor  last position the client reported (undefined after a teleport)
 * @returns { keys, last, until } or undefined when no position follows
 */
function planKeys(engine, ticks, from, anchor, tolerance, minMove) {
  let to = from;
  while (to < ticks.length && to - from < MAX_LOOKAHEAD && ticks[to].move?.x === undefined) to++;
  const target = ticks[to]?.move;
  if (target?.x === undefined) return undefined;
  const window = ticks.slice(from, to + 1);
  const score = (keys, last) => {
    const path = engine.predict(window.map((tick, i) => ({ ...tick.input, ...(i === window.length - 1 ? last : keys) })));
    if (!path) return Infinity;
    const silentMoves = anchor ? path.slice(0, -1).filter((p) => distance(p, anchor) >= minMove).length : 0;
    return distance(path[path.length - 1], target) + silentMoves;
  };
  let best = { error: Infinity };
  for (const keys of DIRECTIONS) {
    const error = score(keys, keys);
    if (error < best.error - 1e-9) best = { error, keys, last: keys };
  }
  if (best.error > tolerance && window.length > 1)
    for (const keys of DIRECTIONS)
      for (const last of DIRECTIONS) {
        const error = score(keys, last);
        if (error < best.error - 1e-9) best = { error, keys, last };
      }
  return best.keys && { keys: best.keys, last: best.last, until: to };
}

module.exports = { planKeys, reportDistance };
