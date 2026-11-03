import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const source = path.join(root, 'native/needle');
export const provenance = JSON.parse(
  fs.readFileSync(path.join(source, 'vendor/provenance.json'), 'utf8'),
);
export function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', ...options });
}
export function fingerprint() {
  const hash = crypto.createHash('sha256');
  const walk = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((file) => {
        const full = path.join(directory, file.name);
        if (file.isDirectory()) walk(full);
        else {
          hash.update(path.relative(source, full));
          hash.update(fs.readFileSync(full));
        }
      });
  };
  walk(path.join(source, 'vendor'));
  ['binding.cc', 'CMakeLists.txt'].forEach((file) =>
    hash.update(fs.readFileSync(path.join(source, file))),
  );
  hash.update(fs.readFileSync(fileURLToPath(import.meta.url)));
  return hash.digest('hex');
}
export function checkout(name, url, revision) {
  const directory = path.join(source, 'engine', name);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  if (!fs.existsSync(path.join(directory, '.git'))) {
    run('git', ['init', directory]);
    run('git', ['-C', directory, 'remote', 'add', 'origin', url]);
    run('git', ['-C', directory, 'fetch', '--depth=1', 'origin', revision]);
    run('git', ['-C', directory, 'checkout', '--detach', 'FETCH_HEAD']);
  }
  const actual = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (actual !== revision)
    throw new Error('Inference dependency revision differs from the pin.');
  run('git', ['-C', directory, 'diff', '--quiet', 'HEAD', '--']);
  return directory;
}
export function dependencies() {
  return checkout(
    'llama.cpp',
    'https://github.com/ggml-org/llama.cpp.git',
    provenance.llamaRevision,
  );
}
export function openblas(build, options = [], arch = process.arch) {
  const directory = checkout(
    'openblas',
    'https://github.com/OpenMathLib/OpenBLAS.git',
    provenance.openblasRevision,
  );
  const prefix = path.join(build, 'openblas-install');
  const binary = path.join(build, 'openblas');
  run('cmake', [
    '-S',
    directory,
    '-B',
    binary,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_INSTALL_PREFIX=${prefix}`,
    ...options,
    `-DTARGET=${arch === 'x64' ? 'GENERIC' : 'ARMV8'}`,
    '-DBUILD_SHARED_LIBS=OFF',
    '-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
    '-DNOFORTRAN=ON',
    '-DBUILD_WITHOUT_LAPACK=ON',
    '-DBUILD_TESTING=OFF',
    '-DUSE_THREAD=OFF',
    '-DUSE_LOCKING=ON',
    `-DDYNAMIC_ARCH=${arch === 'x64' ? 'ON' : 'OFF'}`,
    '-DBUILD_SINGLE=ON',
    '-DBUILD_DOUBLE=OFF',
    '-DBUILD_COMPLEX=OFF',
    '-DBUILD_COMPLEX16=OFF',
  ]);
  run('cmake', ['--build', binary, '--config', 'Release', '-j', '4']);
  run('cmake', ['--install', binary, '--config', 'Release']);
  return prefix;
}
export function notices(destination) {
  const directory = path.join(destination, 'notices');
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(
    path.join(source, 'vendor/LICENSE'),
    path.join(directory, 'runtime-LICENSE.txt'),
  );
  fs.copyFileSync(
    path.join(dependencies(), 'LICENSE'),
    path.join(directory, 'llama-LICENSE.txt'),
  );
  const blas = path.join(source, 'engine/openblas/LICENSE');
  if (fs.existsSync(blas))
    fs.copyFileSync(blas, path.join(directory, 'OpenBLAS-LICENSE.txt'));
}
export function nodeHeaders(arch = process.arch) {
  if (process.env.NODE_INCLUDE_DIR) return process.env.NODE_INCLUDE_DIR;
  const require = createRequire(import.meta.url);
  const nodeGypRequire = createRequire(
    require.resolve('node-gyp/package.json'),
  );
  const { cache } = nodeGypRequire('env-paths')('node-gyp', { suffix: '' });
  run(process.execPath, [
    require.resolve('node-gyp/bin/node-gyp.js'),
    'install',
    '--ensure',
    `--arch=${arch}`,
    `--devdir=${cache}`,
  ]);
  return path.join(cache, process.versions.node, 'include/node');
}
export function bundleWorker(destination) {
  fs.mkdirSync(destination, { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(root, 'src/main/src/ai/runtime/worker.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile: path.join(destination, 'worker.cjs'),
  });
  fs.writeFileSync(
    path.join(destination, 'runtime.cjs'),
    "// Native inference host, bundled from the shared TypeScript runtime.\nrequire('./worker.cjs');\n",
  );
}
export function buildDesktop() {
  let { arch } = process;
  if (process.argv.includes('--arch=x64')) arch = 'x64';
  else if (process.argv.includes('--arch=arm64')) arch = 'arm64';
  const target = `${process.platform}-${arch}`;
  const destination = path.join(root, 'assets/needle', target);
  const build = path.join(source, 'build', target);
  const key = fingerprint();
  bundleWorker(path.dirname(destination));
  let saved;
  try {
    saved = JSON.parse(
      fs.readFileSync(path.join(destination, 'build.json'), 'utf8'),
    );
  } catch {
    /* First build. */
  }
  if (
    saved?.fingerprint === key &&
    fs.existsSync(path.join(destination, 'needle.node'))
  )
    return;
  const headers = nodeHeaders(arch);
  const args = [
    '-S',
    source,
    '-B',
    build,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DLLAMA_SOURCE_DIR=${dependencies()}`,
    `-DNODE_INCLUDE_DIR=${headers}`,
  ];
  if (process.platform === 'darwin')
    args.push(
      `-DCMAKE_OSX_ARCHITECTURES=${arch === 'x64' ? 'x86_64' : 'arm64'}`,
    );
  if (process.platform !== 'darwin') {
    const options =
      process.platform === 'win32'
        ? ['-G', 'Visual Studio 17 2022', '-A', 'x64', '-T', 'ClangCL']
        : [];
    args.push(`-DNEEDLE_OPENBLAS_ROOT=${openblas(build, options, arch)}`);
  }
  if (process.platform === 'win32')
    args.push(
      `-DNODE_LIBRARY=${process.env.NODE_LIBRARY || path.resolve(headers, '../..', arch, 'node.lib')}`,
    );
  run('cmake', args);
  run('cmake', [
    '--build',
    build,
    '--config',
    'Release',
    '--target',
    'jnbot_inference',
    '-j',
    '4',
  ]);
  fs.mkdirSync(destination, { recursive: true });
  const artifact = [
    path.join(build, 'needle.node'),
    path.join(build, 'Release/needle.node'),
  ].find(fs.existsSync);
  if (!artifact) throw new Error('Native binding was not produced.');
  fs.copyFileSync(artifact, path.join(destination, 'needle.node'));
  notices(path.dirname(destination));
  fs.writeFileSync(
    path.join(destination, 'build.json'),
    `${JSON.stringify({ fingerprint: key, target })}\n`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  buildDesktop();
