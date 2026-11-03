/* eslint-disable no-console */
/**
 * Script-runnability matrix.
 *
 * Goal: for every plugin LANGUAGE × runnable TYPE, confirm a plugin actually
 * loads and starts executing in the REAL worker (`main.worker.js`) without
 * joining a server. This catches transpile breakage, worker-bootstrap
 * regressions, runtime-wiring bugs and component-compiler crashes — the
 * stuff unit tests miss because it only shows up when the bundle runs.
 *
 * Why this is a standalone script and not a Jest test: the worker bundle is
 * built with a modern syntax target, so it can't be parsed by the Node that
 * Jest currently runs under (14.x). This harness re-execs itself under a
 * Node >= 18 if needed, then drives real `worker_threads` workers.
 *
 * Covered cells (no server join):
 *   js  / script      → plugin body executes, prints marker, stop()
 *   ts  / script      → transpiled to JS, body executes (tests transpile)
 *   components / script → component compiler + runtime execute a start canvas
 *   js  / action      → action-runner pipeline runs to completion (0 alts)
 *   ts  / action      → same, transpiled
 *
 * NOT covered here (documented in test/README.md):
 *   - action plugin *body* (needs >=1 alt, i.e. a real join)
 *   - profileUi  → executed by ProfileUiRunner (vm, main process), see Jest
 *   - botExtension → loaded into a bot worker as the last plugin (needs join)
 */

const path = require('path');
const fs = require('fs');
const { spawnSync, execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// 0. Ensure we run under a modern Node (worker bundle uses modern syntax).
// ---------------------------------------------------------------------------
const MIN_MAJOR = 18;
const major = Number(process.versions.node.split('.')[0]);
if (major < MIN_MAJOR) {
  const modern = findModernNode(MIN_MAJOR);
  if (!modern) {
    console.error(
      `\n✖ This harness needs Node >= ${MIN_MAJOR} (current: ${process.versions.node}).\n` +
        `  Could not find a newer node automatically. Run it with one, e.g.:\n` +
        `      nvm use 20 && node test/scripts/runScriptMatrix.js\n`,
    );
    process.exit(2);
  }
  console.log(`↻ Re-running under ${modern} (node ${MIN_MAJOR}+ required)…\n`);
  const res = spawnSync(modern, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  process.exit(res.status ?? 1);
}

const { Worker } = require('worker_threads');

// ---------------------------------------------------------------------------
// 1. Locate (and if needed, build) the worker bundle.
// ---------------------------------------------------------------------------
const ROOT = path.join(__dirname, '..', '..');
const DIST_MAIN = path.join(ROOT, 'release', 'app', 'dist', 'main');
const WORKER_PATH = path.join(DIST_MAIN, 'src', 'workers', 'main.worker.js');
const MC_DATA_PATH = path.join(DIST_MAIN, 'src', 'workers');

function ensureWorkerBuilt() {
  if (fs.existsSync(WORKER_PATH)) return;
  console.log('⚙  Worker bundle missing — running `npm run build:main`…');
  execFileSync('npm', ['run', 'build:main'], { cwd: ROOT, stdio: 'inherit' });
  if (!fs.existsSync(WORKER_PATH)) {
    console.error(`✖ Build finished but ${WORKER_PATH} still missing.`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// 2. Fixtures.
// ---------------------------------------------------------------------------
const MARKER = '__PLUGIN_RAN__';

const JS_SCRIPT = `console.log('${MARKER}'); script.stop();`;
// TS-flavoured source: typed locals + an interface to prove type-stripping.
const TS_SCRIPT = `interface M { ok: boolean }
const m: M = { ok: true };
const tag: string = '${MARKER}';
if (m.ok) { console.log(tag); }
script.stop();`;

// A minimal version-3 recipe. The old React-flow canvas used here previously
// was retired; feeding it to RecipeCompiler now correctly raises an error.
const COMPONENTS_CANVAS = {
  kind: 'recipe',
  version: 3,
  recipes: [
    {
      id: 'on-run',
      name: 'On Run',
      role: 'onRun',
      enabled: true,
      trigger: { kind: 'run' },
      steps: [{ id: 'stop', kind: 'stop' }],
    },
  ],
};

const JS_ACTION = `module.exports.main = async (bot) => { console.log('${MARKER}'); };`;
const TS_ACTION = `export const main = async (bot: any): Promise<void> => { console.log('${MARKER}'); };`;

/** TS → CJS using the native esbuild dep (mirrors what the main process does). */
function transpileTs(code) {
  const esbuild = require('esbuild');
  return esbuild.transformSync(code, { loader: 'ts', format: 'cjs' }).code;
}

function macroInfo(language, scriptType) {
  return {
    name: `Test-${language}-${scriptType}`,
    description: '',
    pluginId: `test-${language}-${scriptType}`,
    editedAt: null,
    uploadedAt: null,
    createdAt: Date.now(),
    public: false,
    type: 'private',
    language,
    flags: 0,
    scriptType,
  };
}

/**
 * Each cell: { language, scriptType, code|components, mode }
 *  mode 'exit'      → expect a clean exit (code 0) and the marker (script) /
 *                     completion (action).
 *  mode 'soak'      → run briefly, require no ERROR, then terminate (used for
 *                     long-lived runtimes like components that don't self-exit).
 */
function buildMatrix() {
  return [
    { language: 'js', scriptType: 'script', code: JS_SCRIPT, mode: 'exit', requireMarker: true },
    { language: 'ts', scriptType: 'script', code: transpileTs(TS_SCRIPT), mode: 'exit', requireMarker: true },
    { language: 'components', scriptType: 'script', components: COMPONENTS_CANVAS, mode: 'exit', requireMarker: false },
    { language: 'js', scriptType: 'action', code: JS_ACTION, mode: 'exit', requireMarker: false },
    { language: 'ts', scriptType: 'action', code: transpileTs(TS_ACTION), mode: 'exit', requireMarker: false },
  ];
}

// ---------------------------------------------------------------------------
// 3. Run one cell in a real worker.
// ---------------------------------------------------------------------------
function runCell(cell) {
  const info = macroInfo(cell.language, cell.scriptType);
  const components =
    cell.components ?? { code: cell.code };

  const workerData = {
    scriptName: 'macro',
    script: info.name,
    id: `${info.name}-0`,
    instanceId: 0,
    scriptId: info.pluginId,
    data: { isMacro: true, devMode: true, macroInfo: info, components },
    appSettings: { max_memory_usage: 512 },
    settings: { scripts: {}, altData: {} },
    sharedSettings: { alts: [], devices: [] },
    activeProfile: null,
    paths: { plugins: DIST_MAIN, recordings: DIST_MAIN, minecraftAuth: DIST_MAIN },
    scriptOptions: { startTime: Date.now(), ips: [], disableConsolePrints: false },
    actions: [],
  };

  return new Promise((resolve) => {
    const result = { ready: false, marker: false, error: null, exit: null };
    const w = new Worker(WORKER_PATH, {
      workerData,
      env: { ...process.env, MC_DATA_PATH },
      // Pipe the worker's stdout/stderr into the Worker object (and ignore it)
      // instead of the parent's — we judge success from IPC messages, not logs,
      // so this keeps the matrix report clean.
      stdout: true,
      stderr: true,
      execArgv: ['--no-deprecation'],
    });

    const finish = (verdict, detail) => {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      w.removeAllListeners();
      w.terminate();
      resolve({ ...result, pass: verdict, detail });
    };

    const evaluate = () => {
      if (cell.requireMarker && !result.marker) {
        return finish(false, 'ran but marker never observed');
      }
      if (result.error) return finish(false, `ERROR: ${result.error.message}`);
      return finish(true, cell.mode === 'soak' ? 'started, no error' : 'completed');
    };

    w.on('message', (m) => {
      if (m && m.type === 'READY') result.ready = true;
      if (m && m.type === 'ERROR') result.error = m.payload || { message: 'unknown' };
      if (JSON.stringify(m ?? '').includes(MARKER)) result.marker = true;
    });
    w.on('error', (e) => {
      result.error = { message: e.message };
    });
    w.on('exit', (code) => {
      result.exit = code;
      if (code !== 0 && !result.error) {
        return finish(false, `worker exited with code ${code}`);
      }
      evaluate();
    });

    // 'soak' cells never self-exit; give them a moment then judge.
    const softTimer =
      cell.mode === 'soak' ? setTimeout(evaluate, 3000) : null;
    // Safety net so a hung worker can't wedge the run.
    const hardTimer = setTimeout(
      () => finish(false, 'timed out (15s) — never exited'),
      15000,
    );
  });
}

// ---------------------------------------------------------------------------
// 4. Drive the matrix + report.
// ---------------------------------------------------------------------------
async function main() {
  ensureWorkerBuilt();
  const matrix = buildMatrix();
  console.log(`Running script-runnability matrix (${matrix.length} cells)\n`);

  const rows = [];
  let failures = 0;
  for (const cell of matrix) {
    const r = await runCell(cell);
    if (!r.pass) failures++;
    const label = `${cell.language}/${cell.scriptType}`.padEnd(22);
    const icon = r.pass ? '✓' : '✗';
    rows.push(`  ${icon} ${label} ${r.detail}`);
    console.log(rows[rows.length - 1]);
  }

  console.log(
    `\n${failures === 0 ? '✓ all cells passed' : `✗ ${failures} cell(s) failed`} ` +
      `(${matrix.length - failures}/${matrix.length})`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function findModernNode(minMajor) {
  const candidates = [];
  // nvm-installed versions
  const nvmDir = path.join(process.env.HOME || '', '.nvm', 'versions', 'node');
  try {
    for (const v of fs.readdirSync(nvmDir)) {
      const m = Number(String(v).replace(/^v/, '').split('.')[0]);
      if (m >= minMajor) candidates.push({ m, bin: path.join(nvmDir, v, 'bin', 'node') });
    }
  } catch {
    /* no nvm */
  }
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    try {
      const v = execFileSync(p, ['-v'], { encoding: 'utf8' }).trim();
      const m = Number(v.replace(/^v/, '').split('.')[0]);
      if (m >= minMajor) candidates.push({ m, bin: p });
    } catch {
      /* not present */
    }
  }
  candidates.sort((a, b) => b.m - a.m);
  return candidates.find((c) => fs.existsSync(c.bin))?.bin ?? null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
