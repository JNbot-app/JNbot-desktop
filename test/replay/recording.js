/**
 * Loads a proxy recording (`<id>.json` header + `<id>.log[.gz]` NDJSON, as
 * written by the proxy Recorder) into decoded packets and its tasks.
 *
 * Tasks come from the marker lines `/jnbot task <name>`, `/jnbot task end` and
 * `/jnbot task cancel` write while recording; each one is a stretch of play to
 * compare. A recording without markers is one task covering everything.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createDeserializer } = require('minecraft-protocol');

/** Name of the marker lines the proxy writes for `/jnbot task`. */
const TASK_MARKER = 'jnbot:task';

/** Where the app stores recordings (Electron userData of the `jnbot` app). */
function appRecordingsDir() {
  const home = os.homedir();
  const base =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.platform === 'win32'
        ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
        : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'jnbot', 'recordings');
}

/** Resolves a path, a recording id in the app's folder, or `latest`. */
function resolveRecording(ref) {
  const dir = appRecordingsDir();
  if (ref === 'latest') {
    const logs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.log')) : [];
    if (!logs.length) throw new Error(`No recordings in ${dir}`);
    const newest = logs
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0].f;
    return path.join(dir, newest);
  }
  const candidates = [ref, `${ref}.log`, `${ref}.log.gz`, path.join(dir, ref), path.join(dir, `${ref}.log`)];
  const found = candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!found) throw new Error(`Recording not found: ${ref} (also looked in ${dir})`);
  return path.resolve(found);
}

const basePath = (file) => file.replace(/\.log(\.gz)?$|\.json$/, '');

function readLog(file) {
  const raw = fs.readFileSync(file);
  return (file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8');
}

/**
 * The log's lines as JSON: `entries` are the packets (index = packet.i),
 * `markers` the task markers with `at`, the index of the packet that follows.
 */
function readEntries(logFile) {
  const entries = [];
  const markers = [];
  let unreadable = 0;
  for (const line of readLog(logFile).split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      unreadable++;
      continue;
    }
    if (!entry.m?.marker) entries.push(entry);
    else if (entry.n === TASK_MARKER) markers.push({ ...entry.p, at: entries.length, t: entry.dt });
  }
  return { entries, markers, unreadable };
}


/**
 * Pairs task markers into tasks. `start`/`end` are packet indexes: the task
 * covers the packets in between.
 */
function tasksOf(markers, packetCount, warnings) {
  const tasks = [];
  let open = null;
  for (const marker of markers) {
    if (marker.action === 'start') {
      if (open) tasks.push({ name: open.name, start: open.at, end: marker.at });
      open = marker;
    } else if (open) {
      if (marker.action === 'end') tasks.push({ name: open.name, start: open.at, end: marker.at });
      open = null;
    }
  }
  if (open) {
    warnings.push(`Task ${open.name} was never ended; it runs to the end of the recording.`);
    tasks.push({ name: open.name, start: open.at, end: packetCount });
  }
  // Repeated names get a suffix so every task can be addressed: mine, mine-2, ...
  const seen = {};
  for (const task of tasks) {
    seen[task.name] = (seen[task.name] ?? 0) + 1;
    if (seen[task.name] > 1) task.name += `-${seen[task.name]}`;
  }
  return tasks;
}

/**
 * @returns {{ name, version, file, header, packets: Array<{ i, name, dir, state, t, params, failure? }>,
 *             tasks: Array<{ name, start, end }>, warnings: string[] }}
 */
function loadRecording(ref) {
  const file = resolveRecording(ref);
  const base = basePath(file);
  const headerFile = `${base}.json`;
  const header = fs.existsSync(headerFile) ? JSON.parse(fs.readFileSync(headerFile, 'utf8')) : {};
  const version = header.mcVersion;
  if (!version) throw new Error(`${headerFile} has no mcVersion; is this a proxy recording?`);
  const logFile = file.endsWith('.json') ? [`${base}.log`, `${base}.log.gz`].find(fs.existsSync) : file;

  const parsers = new Map();
  const parserFor = (state, dir) => {
    const key = `${state}:${dir}`;
    if (!parsers.has(key))
      parsers.set(key, createDeserializer({ state, version, isServer: dir === 'c2s', noErrorLogging: true }));
    return parsers.get(key);
  };

  const warnings = [];
  const { entries, markers, unreadable } = readEntries(logFile);
  const counts = { truncated: 0, failed: unreadable };
  const packets = entries.map((entry, i) => {
    const dir = entry.d ?? 'c2s';
    const state = entry.m?.phase ?? 'play';
    let params = entry.p;
    let failure;
    if (entry.r !== undefined) {
      try {
        params = parserFor(state, dir).parsePacketBuffer(Buffer.from(entry.r, 'base64')).data.params;
      } catch (error) {
        failure = error.message;
        counts.failed++;
      }
    }
    if (params?.__truncated) {
      counts.truncated++;
      failure = 'truncated';
    } else if (params?.__unserializable || params?.__unparsed) failure = 'unparsed';
    return { i, name: entry.n, dir, state, t: entry.dt ?? 0, params, failure };
  });

  if (counts.truncated)
    warnings.push(
      `${counts.truncated} packets were truncated (debug recording). Missing chunks make those areas unverifiable; record with "Record sessions from join".`,
    );
  if (counts.failed) warnings.push(`${counts.failed} packets could not be decoded and are ignored.`);
  // The bot needs the join state; anything before the first login is unusable.
  const login = packets.findIndex((p) => p.dir === 's2c' && p.name === 'login');
  if (login < 0)
    throw new Error(
      `${path.basename(base)} starts mid-session (no login packet), so there is no starting state to replay from. ` +
        'Enable "Record sessions from join" in the proxy settings and record again.',
    );
  // Keep the configuration phase (registries, tags) that precedes the login (1.20.2+).
  let start = login;
  let config = login - 1;
  while (config >= 0 && packets[config].state !== 'configuration') config--;
  if (config >= 0) {
    while (config >= 0 && (packets[config].state === 'configuration' || packets[config].name === 'start_configuration')) config--;
    start = config + 1;
  }

  // Indexes stay those of the whole recording (packet.i).
  const tasks = tasksOf(markers.filter((m) => m.at >= start), packets.length, warnings);
  return { name: path.basename(base), version, file: logFile, header, packets: packets.slice(start), tasks, warnings };
}

module.exports = { loadRecording, resolveRecording, appRecordingsDir, basePath, readEntries, TASK_MARKER };
