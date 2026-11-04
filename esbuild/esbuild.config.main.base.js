const esbuild = require('esbuild');
const { copy } = require('esbuild-plugin-copy');
const path = require('path');
const progress = require('esbuild-plugin-progress');
const copyEsbuildWasm = require('./copyEsbuildWasm');
const copyWasmParser = require('./copyWasmParser');
const copyNeedle = require('./copyNeedle');
const buildSecrets = require('./buildSecrets');

async function build(options = {}) {
  const ctx = await esbuild.context({
    entryPoints: [
      './src/main/main.ts',
      './src/main/preload.ts',
      './src/main/src/workers/main.worker.js',
      './src/main/mcp-stdio.ts',
    ],
    bundle: true,
    metafile: true, // 1. Enable the metafile
    platform: 'node',
    minify: true,
    keepNames: true,
    outdir: './release/app/dist/main',
    // esbuild-wasm (TS plugin transpilation, see functions/transpile.ts) stays
    // external so it's never inlined into the bundle. The packaged app doesn't
    // ship the root node_modules, so the two files transpile.ts needs are
    // copied into the build output instead (see copyEsbuildWasm.js).
    external: ['electron', 'esbuild-wasm', 'esbuild-wasm/*'],
    loader: {
      '.png': 'file',
      '.webp': 'file',
      '.mp3': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.svg': 'file',
      '.tsx': 'tsx',
      '.jsx': 'jsx',
      '.json': 'json',
      '.gz': 'file',
    },
    define: buildSecrets,
    plugins: [
      progress(),
      copy({
        assets: {
          from: ['./node_modules/minecraft-data/minecraft-data/data/**/*'],
          to: ['./src/workers/data'],
        },
      }),
    ],
    ...options,
  });

  // 2. Run the build and capture the result
  await ctx.rebuild();

  // esbuild-wasm isn't in the packaged node_modules; copy the files transpile.ts
  // needs into the build output so extraResources ships them.
  copyEsbuildWasm();

  // Same scheme for the Rust→WASM packet parser used by proxyV3 (sibling repo).
  copyWasmParser();
  copyNeedle(path.join(__dirname, '../release/app/dist/main'));

  // 3. Write the metafile data to a JSON file
  // if (result.metafile) {
  //   fs.writeFileSync(
  //     path.join(__dirname, 'meta.json'),
  //     JSON.stringify(result.metafile)
  //   );
  //   console.log('Bundle analysis saved to meta.json');
  // }
}

module.exports = build;
