/* eslint-disable no-console */
// Keep the top of this file parseable by old Node: it re-executes under Node 22.
const path = require('path');
const { ensureNode } = require('../nodeVersion');

ensureNode(22, __filename);

const USAGE = `Replay tests: compare the bot with recordings of a real client doing tasks.

Record: enable "Record sessions from join" in the proxy settings, join, then in game
  /jnbot task <name>     start a task (mine_block, fight_zombie, ride_horse, ...)
  /jnbot task end        end it          /jnbot task cancel   discard it

  npm run test:replay                                  self-test + every fixture against its baseline
  npm run test:replay -- <recording> [options]         replay a recording: a path, an app recording id, or "latest"
  npm run test:replay -- tasks <recording>             list the tasks in a recording
  npm run test:replay -- import <recording> [options]  save each task as a fixture in test/replay/recordings
  npm run test:replay -- baseline [name]               accept the fixtures' current results as their baseline
  npm run test:replay -- synthetic <version> [dir]     write a synthetic recording (the bot playing a test course)

Options:
  --task <name>          only this task
  --from <tick> --to <tick>
                         this tick range instead of the tasks (replay and import)
  --name <name>          fixture name for import (default <task>-<version>)
  --tolerance <blocks>   position error that counts as a mismatch (default 0.001)
  --infer auto|always|never
                         infer the client's keys from its moves (auto: before 1.21.2, which has no player_input)
  --bare                 plain mineflayer, without the app's bot extensions
  --no-sync              don't snap the bot to the recorded position after each tick (shows drift)
  --issues <n>           mismatches to list (default 10)
  --json <file>          also write the full report as JSON
  --blocks <tick>        print the blocks around the player at that tick (before it runs)`;

function parseArgs(argv) {
  const options = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--task') options.task = value();
    else if (arg === '--from') options.from = Number(value());
    else if (arg === '--to') options.to = Number(value());
    else if (arg === '--name') options.name = value();
    else if (arg === '--tolerance') options.tolerance = Number(value());
    else if (arg === '--infer') options.infer = value();
    else if (arg === '--bare') options.extensions = false;
    else if (arg === '--no-sync') options.sync = false;
    else if (arg === '--issues') options.issues = Number(value());
    else if (arg === '--json') options.json = value();
    else if (arg === '--blocks') options.blocks = Number(value());
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else options.positional.push(arg);
  }
  if (options.infer && !['auto', 'always', 'never'].includes(options.infer)) throw new Error('--infer is auto, always or never');
  return options;
}

async function main() {
  const fs = require('fs');
  const { spawnSync } = require('child_process');
  const { loadRecording } = require('./recording');
  const { buildTimeline } = require('./timeline');
  const { replay } = require('./replay');
  const { formatReport } = require('./report');
  const fixtures = require('./fixtures');

  const options = parseArgs(process.argv.slice(2));
  const [command, ...rest] = options.positional;
  if (options.help) return console.log(USAGE);

  if (!command) {
    const result = spawnSync(process.execPath, ['--test', path.join(__dirname, 'replay.test.js')], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
    return;
  }

  if (command === 'tasks') {
    if (!rest[0]) throw new Error('Usage: tasks <recording>');
    const recording = loadRecording(rest[0]);
    const { ticks, tasks } = buildTimeline(recording);
    if (!recording.tasks.length) console.log('No task markers; the whole recording is one task, "all".');
    for (const task of tasks) {
      const seconds = ((ticks[task.to]?.t ?? 0) - (ticks[task.from]?.t ?? 0)) / 1000;
      console.log(`${task.name.padEnd(24)} ticks ${task.from}–${task.to}  (${seconds.toFixed(1)}s)`);
    }
    return;
  }

  if (command === 'import') {
    if (!rest[0]) throw new Error('Usage: import <recording> [--task <name> | --from <tick> --to <tick>] [--name <name>]');
    for (const { file, task, packets, bytes } of fixtures.importRecording(rest[0], options))
      console.log(`Wrote ${path.relative(process.cwd(), file)}: task ${task}, ${packets} packets, ${(bytes / 1024).toFixed(0)} KB`);
    console.log('Private packets (chat, names, scoreboards) were dropped. Review, then run: npm run test:replay -- baseline');
    return;
  }

  if (command === 'baseline') {
    const files = fixtures.listFixtures().filter((file) => !rest[0] || path.basename(file).startsWith(rest[0]));
    if (!files.length) throw new Error(`No fixtures in ${fixtures.FIXTURES_DIR}${rest[0] ? ` matching ${rest[0]}` : ''}`);
    for (const file of files) {
      const report = await replay(loadRecording(file));
      fixtures.writeBaseline(file, report);
      const counts = report.tasks.map((t) => `${t.name} ${t.movement.mismatches} movement / ${t.packets.mismatches} packet`);
      console.log(`${path.basename(file)}: accepted ${counts.join(', ')} mismatches`);
    }
    return;
  }

  if (command === 'synthetic') {
    const { writeSyntheticRecording } = require('./synthetic');
    if (!rest[0]) throw new Error('Usage: synthetic <version> [dir]');
    console.log(`Wrote ${writeSyntheticRecording(rest[0], rest[1] ?? process.cwd())}.log`);
    return;
  }

  const recording = loadRecording(command);
  const onTick = options.blocks === undefined ? undefined : (tick, engine) => {
    if (tick.index !== options.blocks) return;
    const s = engine.state();
    console.log(`Tick ${tick.index}: player at ${[s.x, s.y, s.z].map((n) => n?.toFixed(4)).join(' ')} ${s.onGround ? 'on ground' : 'in air'}, client then reports ${tick.move?.x === undefined ? 'no position' : [tick.move.x, tick.move.y, tick.move.z].map((n) => n.toFixed(4)).join(' ')}`);
    for (const b of engine.surroundings?.() ?? [])
      console.log(`  ${b.x} ${b.y} ${b.z}  ${b.name}  ${b.shapes.length ? JSON.stringify(b.shapes) : 'no collision'}`);
    console.log();
  };
  const report = await replay(recording, { ...options, onTick, maxIssues: Math.max(25, options.issues ?? 10) });
  console.log(formatReport(report, { issues: options.issues }));
  if (options.json) {
    fs.writeFileSync(options.json, JSON.stringify(report, null, 2));
    console.log(`\nFull report: ${options.json}`);
  }
  process.exitCode = report.pass ? 0 : 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
