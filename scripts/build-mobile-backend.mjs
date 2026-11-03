import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import AdmZip from 'adm-zip';
import esbuild from 'esbuild';
import { bundleWorker } from './build-needle.mjs';
import buildSecrets from '../esbuild/buildSecrets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'release', 'mobile-backend');
const archive = path.join(root, 'release', 'build', 'mobile-backend.zip');
const mobileBackend = path.join(
  root,
  '..',
  'jnbot-mobile',
  'nodejs-assets',
  'nodejs-project',
);

const electronMockPlugin = {
  name: 'electron-mock',
  setup(build) {
    build.onResolve({ filter: /^axios$/ }, () => ({
      path: path.join(root, 'src/mobile-backend/mobileHttp.ts'),
    }));
    build.onResolve({ filter: /^discord\.js$/ }, () => ({ path: 'discord.js', namespace: 'mobile-discord-disabled' }));
    build.onLoad({ filter: /.*/, namespace: 'mobile-discord-disabled' }, () => ({
      contents: 'module.exports=new Proxy({}, { get(){ throw new Error("Discord integration is not supported by the mobile runtime."); } });', loader: 'js',
    }));
    build.onResolve({ filter: /^@xmcl\// }, () => ({ path: 'xmcl', namespace: 'mobile-launcher-disabled' }));
    build.onLoad({ filter: /.*/, namespace: 'mobile-launcher-disabled' }, () => ({
      contents: 'const Unsupported=class { constructor(){ throw new Error("Minecraft launcher/server management is not supported by the mobile runtime."); } }; module.exports=new Proxy({}, { get(){ return Unsupported; } });', loader: 'js',
    }));
    build.onResolve({ filter: /^xxhash-wasm$/ }, () => ({ path: 'xxhash-wasm', namespace: 'mobile-wasm-disabled' }));
    build.onLoad({ filter: /.*/, namespace: 'mobile-wasm-disabled' }, () => ({
      contents: 'module.exports=async()=>{ throw new Error("The optional Bedrock xxhash/WASM path is not supported by the mobile runtime."); };', loader: 'js',
    }));
    build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mobile-electron-mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mobile-electron-mock' }, () => ({ contents: 'module.exports = global.electron || {};', loader: 'js' }));
  },
};

// Remove every optional WASM execution path at bundle time instead of relying
// on a runtime feature flag. The produced asset contains neither WASM bytes
// nor code that loads/compiles them.
const wasmFreeMobilePlugin = {
  name: 'wasm-free-mobile-runtime',
  setup(build) {
    build.onLoad({ filter: /src\/main\/src\/functions\/transpile\.ts$/ }, () => ({
      contents: fs.readFileSync(path.join(root, 'src/mobile-backend/mobileTranspile.ts'), 'utf8'),
      loader: 'ts', resolveDir: path.join(root, 'src/mobile-backend'),
    }));
    build.onLoad({ filter: /src\/main\/src\/workers\/bot\/proxyV3\/wasmParser\.ts$/ }, () => ({
      contents: fs.readFileSync(path.join(root, 'src/mobile-backend/tolerantParser.ts'), 'utf8'),
      loader: 'ts', resolveDir: path.join(root, 'src/mobile-backend'),
    }));
  },
};

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const bundle = await esbuild.build({
  entryPoints: {
    main: path.join(root, 'src/mobile-backend/main.ts'),
    'main.worker': path.join(root, 'src/main/src/workers/main.worker.js'),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outdir: output,
  minify: true,
  metafile: true,
  keepNames: true,
  external: ['rn-bridge'],
  inject: [path.join(root, 'src/mobile-backend/mobileFetchInject.ts')],
  define: { 'process.env.CLI_MODE': '"true"', ...buildSecrets },
  plugins: [wasmFreeMobilePlugin, electronMockPlugin],
});
const wasmInputs = Object.keys(bundle.metafile.inputs).filter((input) => /(?:undici|wasm)/i.test(input));
if (wasmInputs.some((input) => /node_modules\/.*(?:undici|xxhash-wasm)/i.test(input)))
  throw new Error(`Mobile bundle resolved a WASM-backed dependency: ${wasmInputs.join(', ')}`);
for (const file of ['main.js', 'main.worker.js'])
  execFileSync(process.execPath, ['--check', path.join(output, file)], { stdio: 'inherit' });

const minecraftData = path.join(root, 'node_modules', 'minecraft-data', 'minecraft-data', 'data');
fs.mkdirSync(path.join(output, 'needle'), { recursive: true });
bundleWorker(path.join(output, 'needle'));
fs.cpSync(minecraftData, path.join(output, 'data'), { recursive: true });
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(path.relative(output, full).replaceAll(path.sep, '/'));
  }
};
walk(output);
if (files.some((file) => file.endsWith('.wasm'))) throw new Error('Mobile backend must not contain WASM files.');
const manifest = {
  format: 1,
  protocolVersion: 1,
  files: Object.fromEntries(files.sort().map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex')])),
};
fs.writeFileSync(path.join(output, 'backend.lock.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.mkdirSync(path.dirname(archive), { recursive: true });
const zip = new AdmZip();
zip.addLocalFolder(output);
zip.writeZip(archive);
if (!process.argv.includes('--no-sync')) {
  fs.rmSync(mobileBackend, { recursive: true, force: true });
  fs.cpSync(output, mobileBackend, { recursive: true });
  console.log(`Synced mobile backend: ${mobileBackend}`);
}
console.log(`Built verified mobile backend: ${archive}`);
