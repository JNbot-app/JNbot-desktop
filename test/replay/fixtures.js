/**
 * Regression fixtures: sanitized recordings in `recordings/` plus a
 * `<name>.baseline.json` with the accepted result. A fixture fails when a
 * change makes it worse than its baseline, so fixing one thing can't silently
 * break another; improvements are reported so the baseline can be tightened.
 *
 * Importing writes one fixture per task: the task, and before it only what
 * the bot needs to start the task in the same state as the client (login,
 * registries, the chunks around the task, live entities, the client's own
 * packets). Everything else before the task is dropped, so a task recorded
 * after an hour of play still makes a small fixture.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const minecraftData = require('minecraft-data');
const { loadRecording, readEntries, basePath, TASK_MARKER } = require('./recording');
const { buildTimeline } = require('./timeline');
const { selectTasks } = require('./replay');
const { MOVES } = require('./packets');

const FIXTURES_DIR = path.join(__dirname, 'recordings');

/**
 * Packets dropped on import: chat and commands (passwords in /login), names,
 * scoreboards, server/resource-pack addresses and plugin channels. None of them
 * affect the bot's state. Login-phase packets (account name, uuid, encryption)
 * are dropped too.
 */
const PRIVATE = new Set([
  'chat', 'chat_message', 'chat_command', 'chat_command_signed', 'chat_session_update', 'message_acknowledgement',
  'system_chat', 'player_chat', 'profileless_chat', 'disguised_chat', 'tab_complete', 'kick_disconnect', 'disconnect',
  'player_info', 'player_remove', 'playerlist_header', 'scoreboard_objective', 'scoreboard_score',
  'scoreboard_display_objective', 'reset_score', 'teams', 'title', 'set_title_text', 'set_title_subtitle',
  'action_bar', 'boss_bar', 'server_data', 'add_resource_pack', 'remove_resource_pack', 'resource_pack_send',
  'custom_payload', 'cookie_request', 'cookie_response', 'store_cookie', 'transfer', 'custom_report_details',
  'server_links', 'open_book', 'edit_book', 'update_sign', 'open_sign_entity', 'map', 'settings',
]);
/** Server packets before a task that leave nothing behind the bot needs. */
const TRANSIENT = new Set([
  'sound_effect', 'named_sound_effect', 'entity_sound_effect', 'stop_sound', 'world_particles', 'world_event',
  'keep_alive', 'ping', 'animation', 'entity_head_rotation', 'update_time', 'hurt_animation', 'damage_event',
  'advancements', 'statistics', 'unlock_recipes', 'recipe_book_add', 'declare_recipes',
]);
/** Chunks this far (in chunks) from the player during the task are kept: physics and the crosshair reach a few blocks. */
const CHUNK_RADIUS = 2;
/** Packets after a task's end are kept for this long, so its last tick is complete. */
const TAIL_MS = 2000;

function listFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((file) => /\.log(\.gz)?$/.test(file))
    .map((file) => path.join(FIXTURES_DIR, file));
}

const chunkKey = (x, z) => `${x},${z}`;
const blockChunk = (pos) => pos && chunkKey(Math.floor(pos.x / 16), Math.floor(pos.z / 16));

/** The chunk a server packet is about, if it is about one. */
function chunkOf({ name, params: p }) {
  if (!p) return undefined;
  if (name === 'map_chunk') return chunkKey(p.x, p.z);
  if (name === 'unload_chunk' || name === 'update_light') return chunkKey(p.chunkX, p.chunkZ);
  if (name === 'block_change' || name === 'tile_entity_data') return blockChunk(p.location);
  if (name === 'multi_block_change') return p.chunkCoordinates ? chunkKey(p.chunkCoordinates.x, p.chunkCoordinates.z) : chunkKey(p.chunkX, p.chunkZ);
  return undefined;
}

/**
 * Indexes of the packets the bot doesn't need: before the task (`start`),
 * transient effects, chunks that were unloaded or replaced, and entities that
 * were removed; anywhere, chunks far from the player during the task.
 */
function droppable(recording, start, end) {
  const prefix = recording.packets.filter((p) => p.i < start);
  const drop = new Set();
  for (const p of prefix) if (p.dir === 's2c' && TRANSIENT.has(p.name)) drop.add(p.i);

  // Entities: everything before an entity's last removal is gone.
  const removed = new Map();
  for (const p of prefix)
    if (p.dir === 's2c' && (p.name === 'entity_destroy' || p.name === 'destroy_entity'))
      for (const id of p.params?.entityIds ?? [p.params?.entityId]) removed.set(id, p.i);
  for (const p of prefix) {
    const id = p.params?.entityId;
    if (p.dir === 's2c' && removed.get(id) > p.i && p.name !== 'login' && p.name !== 'respawn') drop.add(p.i);
  }

  // Chunks (1.9+, where unloading has its own packet): keep the last load of
  // the chunks near the task and what changed in them since, and the chunks
  // near the player that load during the task.
  if (!minecraftData(recording.version).protocol.play.toClient.types.packet_unload_chunk) return drop;
  const near = new Set();
  const visit = (x, z) => {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++)
      for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) near.add(chunkKey(cx + dx, cz + dz));
  };
  let last;
  for (const p of recording.packets) {
    if (p.i >= end) break;
    if (p.dir !== 'c2s' || !MOVES.has(p.name) || p.params?.x === undefined) continue;
    if (p.i < start) last = p.params;
    else visit(p.params.x, p.params.z);
  }
  if (last) visit(last.x, last.z);
  const loaded = new Map(); // chunk → index of its last full load, or -1 once unloaded
  for (const p of prefix)
    if (p.dir === 's2c' && p.name === 'map_chunk' && p.params?.groundUp !== false) loaded.set(chunkOf(p), p.i);
    else if (p.dir === 's2c' && p.name === 'unload_chunk') loaded.set(chunkOf(p), -1);
  for (const p of prefix) {
    const chunk = p.dir === 's2c' ? chunkOf(p) : undefined;
    if (chunk === undefined) continue;
    const at = loaded.get(chunk) ?? -1;
    // Light can arrive just before its chunk, so it isn't held to the load order.
    if (!near.has(chunk) || at < 0 || (p.i < at && p.name !== 'update_light')) drop.add(p.i);
  }
  for (const p of recording.packets)
    if (p.i >= start && p.dir === 's2c' && (p.name === 'map_chunk' || p.name === 'update_light') && !near.has(chunkOf(p))) drop.add(p.i);
  return drop;
}

const markerLine = (action, name, dt) => JSON.stringify({ n: TASK_MARKER, dt, p: { action, name }, m: { marker: true }, d: 'c2s' });

function freeName(name) {
  let candidate = name;
  for (let n = 2; fs.existsSync(path.join(FIXTURES_DIR, `${candidate}.log.gz`)); n++) candidate = `${name}-${n}`;
  return candidate;
}

/**
 * Writes one fixture per task of a recording: its tasks, the one named
 * `options.task`, or the tick range `options.from`–`options.to`.
 * @returns [{ file, task, packets, bytes }]
 */
function importRecording(ref, options = {}) {
  const recording = loadRecording(ref);
  const timeline = buildTimeline(recording);
  const { entries } = readEntries(recording.file);
  const header = recording.header;
  const ranges = selectTasks(timeline, options);
  const multiple = ranges.length > 1;

  return ranges.map((range, n) => {
    // Packet bounds of the task's ticks (markers sit right before `start` and `end`).
    const c2s = timeline.ticks.slice(range.from, range.to + 1).flatMap((tick) => tick.c2s);
    if (!c2s.length) throw new Error(`Task ${range.name} has no client packets`);
    const start = c2s[0].i;
    const end = c2s[c2s.length - 1].i + 1;
    const stop = entries.findIndex((e, i) => i >= end && (e.dt ?? 0) > (entries[end - 1]?.dt ?? 0) + TAIL_MS);
    const drop = droppable(recording, start, end);
    const first = recording.packets[0].i; // replay starts at the join

    const id = freeName(options.name ? (multiple ? `${options.name}-${n + 1}` : options.name) : `${range.name}-${recording.version}`);
    const kept = entries.slice(0, stop < 0 ? entries.length : stop);
    const lines = [];
    let dropped = 0;
    kept.forEach((entry, i) => {
      if (i === start) lines.push(markerLine('start', range.name, entry.dt));
      if (i === end) lines.push(markerLine('end', range.name, entry.dt));
      const phase = entry.m?.phase ?? 'play';
      if (i < first || drop.has(i) || PRIVATE.has(entry.n) || (phase !== 'play' && phase !== 'configuration')) return dropped++;
      // Only what the replay reads; metadata carries session and participant ids.
      lines.push(JSON.stringify({ n: entry.n, dt: entry.dt, p: entry.p, r: entry.r, m: { phase }, d: entry.d }));
    });
    if (end >= kept.length) lines.push(markerLine('end', range.name, kept[kept.length - 1]?.dt));

    const target = path.join(FIXTURES_DIR, id);
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    const data = zlib.gzipSync(lines.join('\n') + '\n', { level: 9 });
    fs.writeFileSync(`${target}.log.gz`, data);
    fs.writeFileSync(
      `${target}.json`,
      JSON.stringify({ id, name: id, kind: header.kind, version: header.version, mcVersion: header.mcVersion, packetCount: lines.length - 2, source: recording.name, task: range.name }, null, 2) + '\n',
    );
    return { file: `${target}.log.gz`, task: range.name, packets: lines.length - 2, dropped, bytes: data.length };
  });
}

const baselineFile = (recordingFile) => `${basePath(recordingFile)}.baseline.json`;

function readBaseline(recordingFile) {
  const file = baselineFile(recordingFile);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

function summarize(report) {
  return {
    version: report.version,
    tasks: Object.fromEntries(
      report.tasks.map((task) => [
        task.name,
        {
          movementChecked: task.movement.checked,
          movementMismatches: task.movement.mismatches,
          packetsChecked: task.packets.checked,
          packetMismatches: task.packets.mismatches,
          maxError: Number(task.movement.maxError.toFixed(6)),
        },
      ]),
    ),
  };
}

function writeBaseline(recordingFile, report) {
  fs.writeFileSync(baselineFile(recordingFile), JSON.stringify(summarize(report), null, 2) + '\n');
}

/** Lists what got worse and what got better than the baseline. */
function compareToBaseline(report, baseline) {
  const now = summarize(report).tasks;
  const worse = [];
  const better = [];
  for (const [name, base] of Object.entries(baseline.tasks ?? {})) {
    const task = now[name];
    if (!task) {
      worse.push(`task ${name} is missing`);
      continue;
    }
    const check = (key, label, slack = 0) => {
      if (task[key] > base[key] + slack) worse.push(`${name}: ${label} ${base[key]} → ${task[key]}`);
      else if (task[key] < base[key] - slack) better.push(`${name}: ${label} ${base[key]} → ${task[key]}`);
    };
    check('movementMismatches', 'movement mismatches');
    check('packetMismatches', 'packet mismatches');
    check('maxError', 'max error', 1e-6);
    // Fewer comparable ticks hides problems instead of fixing them.
    for (const key of ['movementChecked', 'packetsChecked'])
      if (task[key] < base[key]) worse.push(`${name}: ${key} ${base[key]} → ${task[key]}`);
  }
  return { worse, better };
}

module.exports = { FIXTURES_DIR, listFixtures, importRecording, readBaseline, writeBaseline, compareToBaseline };
