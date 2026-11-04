const esbuild = require('esbuild');
const progress = require('esbuild-plugin-progress');

const path = require('path');
const copyEsbuildWasm = require('./copyEsbuildWasm');
const copyWasmParser = require('./copyWasmParser');
const copyNeedle = require('./copyNeedle');
const buildSecrets = require('./buildSecrets');

async function build() {
  let initialBuild = true;
  const ctx = await esbuild.context({
    entryPoints: [
      './src/main/main.ts',
      './src/main/preload.ts',
      './src/main/src/workers/main.worker.js',
    ],
    bundle: true,
    platform: 'node',
    minify: false,
    keepNames: true, // If false we get an error in discord.js
    outdir: './release/app/dist/main', // Specify output directory
    // esbuild-wasm (TS plugin transpilation, see functions/transpile.ts) stays
    // external so it's never inlined into main.js. The packaged app doesn't ship
    // the root node_modules, so the two files transpile.ts needs are copied into
    // the build output instead (see copyEsbuildWasm.js).
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
    define: {
      'process.env.NODE_ENV': '"development"',
      ...buildSecrets,
    },
    plugins: [
      progress(),
      // copy({
      //   once: true,
      //   assets: [
      //     {
      //       from: ['./node_modules/minecraft-data/minecraft-data/data/**/*'],
      //       to: ['./src/workers/data'],
      //     },
      //   ],
      // }),
      {
        name: 'initial-build-ready',
        setup(build) {
          build.onEnd((result) => {
            if (!initialBuild) return;
            initialBuild = false;
            if (result.errors.length) process.exit(1);

            copyEsbuildWasm();
            copyWasmParser();
            copyNeedle(path.join(__dirname, '../release/app/dist/main'));
            console.info('Main process ready');
          });
        },
      },
    ],
  });

  await ctx.watch();
}

build().catch(() => process.exit(1));
