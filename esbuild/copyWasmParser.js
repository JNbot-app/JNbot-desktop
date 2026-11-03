const fs = require('fs');
const path = require('path');

/**
 * The Rust→WASM packet parser (`mcPacketParser`, a sibling repo of `app/`) is
 * loaded at runtime by `proxyV3/wasmParser.ts`. The wasm-bindgen node glue
 * reads its `*_bg.wasm` relative to its own `__dirname`, so the glue and the
 * wasm binary must sit next to each other on disk — they cannot be inlined into
 * the esbuild bundle. We copy them into:
 *
 *   dist/main/src/mc-packet-parser/{mc_packet_parser.js, *_bg.wasm}
 *
 * which electron-builder ships verbatim through `extraResources`
 * (`dist/main/src` -> `Resources/src`). `wasmParser.ts` resolves them from
 * `__dirname` (dev) / `process.resourcesPath` (packed) — the same scheme used
 * for `main.worker.js` and esbuild-wasm (see copyEsbuildWasm.js).
 *
 * Build the wasm first with `npm run build` inside `mcPacketParser/`
 * (`wasm-pack build --target nodejs`). If it isn't built, we warn and skip so
 * the app still builds and `wasmParser.ts` falls back to the JS parser.
 */
function copyWasmParser() {
  const root = path.join(__dirname, '..');
  const srcDir = path.join(root, '..', 'mcPacketParser', 'pkg');
  const destDir = path.join(
    root,
    'release',
    'app',
    'dist',
    'main',
    'src',
    'mc-packet-parser',
  );

  const files = ['mc_packet_parser.js', 'mc_packet_parser_bg.wasm'];
  const missing = files.filter((f) => !fs.existsSync(path.join(srcDir, f)));
  if (missing.length) {
    console.warn(
      `[copyWasmParser] skipped — ${srcDir} is missing ${missing.join(', ')}. ` +
        'Build it with `wasm-pack build --target nodejs` in mcPacketParser/. ' +
        'The proxy will fall back to the JS packet parser.',
    );
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
}

module.exports = copyWasmParser;
