const esbuild = require('esbuild');
const { copy } = require('esbuild-plugin-copy');
const fs = require('fs');
const path = require('path');
const progress = require('esbuild-plugin-progress');
const copyNeedle = require('./copyNeedle');
const buildSecrets = require('./buildSecrets');

// Create a plugin to handle electron imports
const electronMockPlugin = {
  name: 'electron-mock',
  setup(build) {
    // Intercept import or require statements for 'electron'
    build.onResolve({ filter: /^electron$/ }, args => {
      return { path: args.path, namespace: 'electron-mock' };
    });

    // Return empty exports for electron
    build.onLoad({ filter: /.*/, namespace: 'electron-mock' }, () => {
      return {
        contents: `
          module.exports = global.electron || {};
        `,
        loader: 'js'
      };
    });
  }
};

async function build() {
  const ctx = await esbuild.context({
    entryPoints: [
      './src/main/preload.ts',
      './src/main/src/workers/main.worker.js',
    ],
    bundle: true,
    platform: 'node',
    minify: true,
    keepNames: true, // If false we get an error in discord.js
    outdir: './release/app/dist/cli', // Specify output directory
    external: [
      'electron', // Mark electron as external
      'electron-devtools-installer', // Any other electron-specific modules
    ],
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
      '.flf': 'file', 
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.CLI_MODE': "'true'",
      ...buildSecrets,
    },
    plugins: [
      electronMockPlugin, // Add our plugin first
      progress(),
      copy({
        assets: {
          from: ['./node_modules/minecraft-data/minecraft-data/data/**/*'],
          to: ['./main/src/workers/data'],
        },
      }),
    ],
  });
  await ctx.rebuild();

  // Ink 5 is native ESM and uses top-level await. Keep the existing preload
  // and worker bundles CommonJS, but emit the CLI itself as a small ESM entry.
  const cliCtx = await esbuild.context({
    entryPoints: ['./src/cli/cli.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    minify: true,
    keepNames: true,
    outdir: './release/app/dist/cli',
    outbase: './src',
    outExtension: { '.js': '.mjs' },
    banner: {
      js: "import { createRequire as __createRequire } from 'module'; import { fileURLToPath as __fileURLToPath } from 'url'; import { dirname as __dirnameOf } from 'path'; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __dirnameOf(__filename);",
    },
    loader: {
      '.png': 'file', '.webp': 'file', '.mp3': 'file', '.woff': 'file',
      '.woff2': 'file', '.ttf': 'file', '.svg': 'file', '.tsx': 'tsx',
      '.jsx': 'jsx', '.json': 'json', '.gz': 'file', '.flf': 'file',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.CLI_MODE': "'true'",
      ...buildSecrets,
    },
    plugins: [electronMockPlugin, progress()],
  });
  await cliCtx.rebuild();
  copyNeedle(path.join(__dirname, '../release/app/dist/cli/cli'));

  // Ink's Yoga runtime resolves this file next to the bundled ESM entry.
  const yogaSource = path.join(__dirname, '../node_modules/yoga-wasm-web/dist/yoga.wasm');
  const yogaDestination = path.join(__dirname, '../release/app/dist/cli/cli/yoga.wasm');
  fs.mkdirSync(path.dirname(yogaDestination), { recursive: true });
  fs.copyFileSync(yogaSource, yogaDestination);
  await Promise.all([ctx.dispose(), cliCtx.dispose()]);
  
  // Create the bin scripts for cross-platform execution
  const binDir = path.join(__dirname, '../release/app/dist/cli');
  
  // Create Unix/macOS executable script
  const unixBinFile = path.join(binDir, 'jnbot');
  fs.writeFileSync(
    unixBinFile,
    `#!/usr/bin/env node

process.title = 'JNbot CLI';

const skipVersionCheck = process.argv.includes('--skip-version-check');

if (!skipVersionCheck) {
  const nodeVersion = process.versions.node;
  const majorVersion = parseInt(nodeVersion.split('.')[0], 10);

  if (majorVersion < 18) {
    console.error('Error: JNBot requires Node.js version 18 or above.');
    console.error(\`You are currently using Node.js \${nodeVersion}.\`);
    console.error('Please upgrade your Node.js installation and try again.');
    console.error('You can bypass this check with --skip-version-check');
    process.exit(1);
  }
}

import('./cli/cli.mjs');
`,
    { mode: 0o755 } // Set executable permissions for Unix-like systems
  );
  
  // Create Windows batch file
  const winBinFile = path.join(binDir, 'jnbot.cmd');
  fs.writeFileSync(
    winBinFile,
    `@echo off
setlocal

set "skipVersionCheck="
for %%a in (%*) do if "%%a"=="--skip-version-check" set "skipVersionCheck=1"

if not defined skipVersionCheck (
  for /f "tokens=1 delims=." %%a in ('node --version') do set "nodeRaw=%%a"
  set "nodeMajor=%nodeRaw:~1%"

  if %nodeMajor% LSS 18 (
    echo Error: JNBot requires Node.js version 18 or above.
    echo You are currently using Node.js %nodeRaw%
    echo Please upgrade your Node.js installation and try again.
    echo You can bypass this check with --skip-version-check
    exit /b 1
  )
)

node "%~dp0cli\cli.mjs" %*
`
  );
  
  // Create PowerShell script for modern Windows environments
  const psBinFile = path.join(binDir, 'jnbot.ps1');
  fs.writeFileSync(
    psBinFile,
    `#!/usr/bin/env pwsh
$skipVersionCheck = $args -contains "--skip-version-check"

if (-not $skipVersionCheck) {
  $nodeVersion = (node --version).Substring(1)
  $majorVersion = [int]($nodeVersion.Split('.')[0])

  if ($majorVersion -lt 18) {
    Write-Error "Error: JNBot requires Node.js version 18 or above."
    Write-Error "You are currently using Node.js $nodeVersion."
    Write-Error "Please upgrade your Node.js installation and try again."
    Write-Error "You can bypass this check with --skip-version-check"
    exit 1
  }
}

node "$PSScriptRoot/cli/cli.mjs" $args
`
  );
  
  console.log('CLI build completed successfully!');
  console.log(`Created executables at: 
  - Unix/macOS: ${unixBinFile}
  - Windows (CMD): ${winBinFile}
  - Windows (PowerShell): ${psBinFile}`);
}

async function runBuild() {
  await build();
  process.exit(0);
}

runBuild().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

module.exports = build;
