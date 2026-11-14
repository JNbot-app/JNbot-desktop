/**
 * Comparisons run on every tick of a task. A check gets the tick's facts and
 * keeps its own counts and first issues; `finish()` returns its result for the
 * report. Add a check here and to CHECKS to compare something new.
 *
 * Facts per tick: { tick, t, state (engine), input, client, bot (packet labels), events }
 */
const round = (n, d = 4) => Number(n.toFixed(d));
const KEYS = { forward: 'W', back: 'S', left: 'A', right: 'D', jump: 'jump', sprint: 'sprint', sneak: 'sneak', flying: 'fly' };

function describeInput(input) {
  const parts = Object.keys(KEYS).filter((k) => input[k]).map((k) => KEYS[k]);
  for (const button of ['left', 'right']) if (input.mouse?.[button].held || input.mouse?.[button].presses) parts.push(`${button}-click`);
  return parts.join('+') || 'idle';
}

/** Position and onGround versus what the client reported. */
function movement({ tolerance, maxIssues }) {
  const r = { checked: 0, mismatches: 0, maxError: 0, meanError: 0, issues: [] };
  let sum = 0;
  return {
    name: 'movement',
    tick({ tick, t, state, input, events }) {
      const move = tick.move;
      if (move?.x === undefined) return;
      const dx = state.x - move.x;
      const dy = state.y - move.y;
      const dz = state.z - move.z;
      const error = Math.hypot(dx, dy, dz);
      const groundDiffers = move.onGround !== undefined && move.onGround !== state.onGround;
      r.checked++;
      sum += error;
      r.maxError = Math.max(r.maxError, error);
      if (error <= tolerance && !groundDiffers) return;
      r.mismatches++;
      if (r.issues.length < maxIssues)
        r.issues.push({
          tick: tick.index,
          t,
          error: round(error, 6),
          delta: { x: round(dx, 6), y: round(dy, 6), z: round(dz, 6) },
          client: { x: move.x, y: move.y, z: move.z, onGround: move.onGround },
          bot: { x: state.x, y: state.y, z: state.z, onGround: state.onGround },
          velocity: { x: round(state.vx, 5), y: round(state.vy, 5), z: round(state.vz, 5) },
          input: describeInput(input),
          events,
        });
    },
    finish() {
      r.meanError = r.checked ? sum / r.checked : 0;
      return r;
    },
  };
}

/** The compared packets (packets.js) of each tick, in order. */
function packets({ maxIssues }) {
  const r = { checked: 0, mismatches: 0, kinds: {}, issues: [] };
  return {
    name: 'packets',
    tick({ tick, t, client, bot, events, input }) {
      if (tick.idle) return;
      r.checked++;
      if (client.join() === bot.join()) return;
      r.mismatches++;
      const kind = `client [${client.join(', ')}] vs bot [${bot.join(', ')}]`;
      r.kinds[kind] = (r.kinds[kind] ?? 0) + 1;
      if (r.issues.length < maxIssues) r.issues.push({ tick: tick.index, t, client, bot, input: describeInput(input), events });
    },
    finish: () => r,
  };
}

const CHECKS = [movement, packets];

module.exports = { CHECKS };
