/**
 * Replay suite (node:test, run via `npm run test:replay`).
 *
 * 1. Self-test: a synthetic recording made by the engine must replay with zero
 *    mismatches for every tick-boundary mode, so harness bugs show up here.
 * 2. Fixtures: every task in `recordings/` must not get worse than its
 *    `.baseline.json`.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadRecording } = require('./recording');
const { replay } = require('./replay');
const { formatReport } = require('./report');
const { writeSyntheticRecording } = require('./synthetic');
const { listFixtures, readBaseline, compareToBaseline } = require('./fixtures');

/** One version per tick-boundary mode and protocol era. */
const SYNTHETIC_VERSIONS = ['1.8.9', '1.12.2', '1.20.4', '1.21.4', '1.21.11'];
/** Engine bugs the self-test exposes (reported as todo); the harness reads the wire correctly. */
const KNOWN_ENGINE_BUGS = {};

test('synthetic recordings replay without mismatches', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-replay-'));
  try {
    for (const version of SYNTHETIC_VERSIONS)
      await t.test(version, { todo: KNOWN_ENGINE_BUGS[version] }, async () => {
        const recording = loadRecording(`${writeSyntheticRecording(version, dir)}.log`);
        const sent = new Set(recording.packets.filter((p) => p.dir === 'c2s').map((p) => p.name));
        for (const name of ['block_dig', 'arm_animation', 'block_place', 'held_item_slot'])
          assert.ok(sent.has(name), `The course sent no ${name}, so the mouse and hotbar went untested`);
        const report = await replay(recording);
        assert.deepStrictEqual(report.tasks.map((t) => t.name), ['move', 'mouse']);
        assert.ok(report.pass, formatReport(report));
      });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const file of listFixtures())
  test(`fixture ${path.basename(file)}`, async () => {
    const baseline = readBaseline(file);
    assert.ok(baseline, `No baseline for ${path.basename(file)}; run: npm run test:replay -- baseline`);
    const report = await replay(loadRecording(file));
    const { worse, better } = compareToBaseline(report, baseline);
    if (better.length) console.log(`${path.basename(file)} improved (${better.join(', ')}); update with: npm run test:replay -- baseline`);
    assert.deepStrictEqual(worse, [], `${worse.join(', ')}\n\n${formatReport(report)}`);
  });
