/**
 * Replays a recording of a real client against an engine and reports, per
 * task, where the engine moves or sends packets differently.
 *
 * Every tick: the server packets of that tick are applied, the client's input
 * (keys, look, mouse, hotbar; see inputs.js) is set, the engine runs one tick,
 * and the checks (checks.js) compare it with the client. The engine is then
 * snapped to the client's position (keeping its own velocity) so one error
 * does not cascade into every later tick.
 *
 * Ticks outside the tasks only bring the engine up to date: they run without
 * key inference or comparisons, so a task late in a recording is quick.
 */
const { buildTimeline } = require('./timeline');
const { planKeys, reportDistance } = require('./inferKeys');
const { labels } = require('./packets');
const { CHECKS } = require('./checks');
const { createMineflayerEngine } = require('./engines/mineflayer');

/** Server packets worth showing next to a mismatch. */
const NOTABLE = new Set([
  'position', 'entity_velocity', 'explosion', 'abilities', 'entity_effect', 'remove_entity_effect',
  'entity_update_attributes', 'update_attributes', 'block_change', 'multi_block_change', 'game_state_change',
  'respawn', 'set_passengers', 'attach_entity', 'map_chunk', 'unload_chunk', 'damage_event', 'open_window',
]);

/** The tasks to compare: an explicit tick range, the named task, or all of the recording's. */
function selectTasks(timeline, { task, from, to, name = 'range' }) {
  if (from !== undefined || to !== undefined)
    return [{ name, from: from ?? 0, to: Math.min(to ?? Infinity, timeline.ticks.length - 1) }];
  if (task === undefined) return timeline.tasks;
  const found = timeline.tasks.filter((t) => t.name === task);
  if (!found.length) throw new Error(`No task ${task}; the recording has ${timeline.tasks.map((t) => t.name).join(', ')}`);
  return found;
}

/**
 * @param recording  result of loadRecording()
 * @param options    { tolerance, infer: 'auto'|'always'|'never', extensions, sync, task, from, to, maxIssues,
 *                     createEngine, onTick(tick, engine) — called before each tick runs, e.g. to inspect the engine }
 */
async function replay(recording, options = {}) {
  const {
    tolerance = 1e-3,
    infer = 'auto',
    extensions = true,
    sync = true,
    maxIssues = 25,
    createEngine = createMineflayerEngine,
    onTick,
  } = options;
  const timeline = buildTimeline(recording);
  const tasks = selectTasks(timeline, options).map((task) => ({
    ...task,
    skipped: {},
    checks: CHECKS.map((create) => create({ tolerance, maxIssues })),
  }));
  const inferring = infer === 'always' || (infer === 'auto' && !timeline.keysKnown);
  const minMove = reportDistance(recording.version);
  const engine = createEngine({ version: recording.version, extensions });
  const taskAt = (index) => tasks.find((task) => index >= task.from && index <= task.to);

  let plan;
  let anchor; // last position the client reported
  const lastInput = {}; // last player_input label per side
  try {
    for (const tick of timeline.ticks) {
      const task = taskAt(tick.index);
      engine.receive(tick.s2c.map(({ name, params, state }) => ({ name, params, state })));
      if (tick.s2c.some((p) => p.name === 'position')) anchor = undefined; // teleported
      if (task && inferring && !(plan && tick.index <= plan.until) && engine.state().ready)
        plan = planKeys(engine, timeline.ticks, tick.index, anchor, tolerance, minMove);
      const planned = task && inferring && plan && tick.index <= plan.until;
      const input = planned ? { ...tick.input, ...(tick.index === plan.until ? plan.last : plan.keys) } : tick.input;
      onTick?.(tick, engine);
      engine.applyInput(input);
      engine.step();
      const sent = engine.takeSent();
      await new Promise(setImmediate); // let promise-based plugin code run, like a real event loop

      const state = engine.state();
      const client = labels(tick.c2s, lastInput, 'client');
      const bot = labels(sent, lastInput, 'bot');
      if (task && !state.ready) {
        if (tick.move || tick.c2s.length) task.skipped[state.skip] = (task.skipped[state.skip] ?? 0) + 1;
      } else if (task) {
        const facts = {
          tick,
          t: Number(((tick.t ?? 0) / 1000).toFixed(2)),
          state,
          input,
          client,
          bot,
          events: [...new Set(tick.s2c.filter((p) => NOTABLE.has(p.name)).map((p) => p.name))],
        };
        for (const check of task.checks) check.tick(facts);
      }
      // Also while not comparable (no chunk loaded, dead, riding): the client is still somewhere.
      if (state.skip !== 'not-spawned' && tick.move?.x !== undefined) {
        if (sync) engine.syncPosition(tick.move);
        anchor = tick.move;
      }
    }
  } finally {
    engine.close();
  }

  const warnings = [...recording.warnings];
  if (engine.errors.length) {
    const first = engine.errors[0];
    warnings.push(`The engine threw ${engine.errors.length} errors, first: ${first?.stack?.split('\n').slice(0, 2).join(' ') ?? first}`);
  }
  const results = tasks.map(({ name, from, to, skipped, checks }) => {
    const result = { name, from, to, skipped, ...Object.fromEntries(checks.map((check) => [check.name, check.finish()])) };
    const compared = result.movement.checked + result.packets.checked;
    result.pass = compared > 0 && checks.every((check) => result[check.name].mismatches === 0);
    if (!compared) warnings.push(`Nothing in task ${name} could be compared; see its skipped counts.`);
    return result;
  });
  return {
    recording: recording.name,
    version: recording.version,
    engine: engine.name,
    mode: timeline.mode,
    inputs: inferring ? 'inferred' : 'recorded',
    tolerance,
    ticks: timeline.ticks.length,
    tasks: results,
    warnings,
    pass: results.every((r) => r.pass),
  };
}

module.exports = { replay, selectTasks };
