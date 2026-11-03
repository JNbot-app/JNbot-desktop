const fs = require('fs');
const path = require('path');

/**
 * The packaged app ships `release/app/node_modules` (native deps only), NOT the
 * root `node_modules`, so `esbuild-wasm` is never packaged. It's used to
 * transpile TS plugins at runtime (see src/main/src/functions/transpile.ts), so
 * we copy the two files we actually need into the build output:
 *
 *   - esm/browser.js  -> the in-process (no child-process) build
 *   - esbuild.wasm    -> the 11 MB wasm binary
 *
 * They land under `dist/main/src/esbuild-wasm/`, which electron-builder ships
 * verbatim through `extraResources` (`dist/main/src` -> `Resources/src`).
 * transpile.ts then loads them from `__dirname` (dev) / `process.resourcesPath`
 * (packed) — the same scheme used for `main.worker.js`.
 */
function copyEsbuildWasm() {
  const root = path.join(__dirname, '..');
  const srcDir = path.join(root, 'node_modules', 'esbuild-wasm');
  const destDir = path.join(
    root,
    'release',
    'app',
    'dist',
    'main',
    'src',
    'esbuild-wasm',
  );

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(
    path.join(srcDir, 'esm', 'browser.js'),
    path.join(destDir, 'browser.js'),
  );
  fs.copyFileSync(
    path.join(srcDir, 'esbuild.wasm'),
    path.join(destDir, 'esbuild.wasm'),
  );
}

module.exports = copyEsbuildWasm;
