import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  source,
  fingerprint,
  nodeHeaders,
  openblas,
  notices,
  run,
} from './build-needle.mjs';

const { engineRevision } = JSON.parse(
  fs.readFileSync(path.join(source, 'model.json'), 'utf8'),
);
const directory = path.join(source, 'engine/mobile', engineRevision);
const key = fingerprint();
fs.mkdirSync(directory, { recursive: true });
const headers = nodeHeaders();
const android = !process.argv.includes('--ios');
const ios = !process.argv.includes('--android');
if (android) {
  const ndk =
    process.env.ANDROID_NDK_HOME ||
    process.env.ANDROID_NDK_ROOT ||
    path.join(os.homedir(), 'Library/Android/sdk/ndk/27.1.12297006');
  const toolchain = path.join(ndk, 'build/cmake/android.toolchain.cmake');
  if (!fs.existsSync(toolchain))
    throw new Error('Set ANDROID_NDK_HOME to an installed NDK 27.1 or newer.');
  const build = path.join(source, 'build/android-arm64');
  const options = [
    `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,
    '-DANDROID_ABI=arm64-v8a',
    '-DANDROID_PLATFORM=android-24',
    '-DANDROID_STL=c++_shared',
    '-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON',
  ];
  const blas = openblas(build, options, 'arm64');
  // Gradle links the same static dependencies from this configured build.
  run('cmake', [
    '-S',
    source,
    '-B',
    build,
    ...options,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DJNBOT_MOBILE=ON',
    `-DNODE_INCLUDE_DIR=${headers}`,
    `-DNEEDLE_OPENBLAS_ROOT=${blas}`,
  ]);
  run('cmake', ['--build', build, '--target', 'jnbot_inference', '-j', '4']);
  fs.cpSync(blas, path.join(directory, 'openblas-install'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(directory, 'android-build.json'),
    `${JSON.stringify({ fingerprint: key })}\n`,
  );
}
if (ios) {
  const libraries = [];
  [
    ['iphoneos', 'arm64'],
    ['iphonesimulator', 'arm64'],
    ['iphonesimulator', 'x86_64'],
  ].forEach(([sdk, arch]) => {
    const build = path.join(source, 'build', `${sdk}-${arch}`);
    const sdkPath = execFileSync('xcrun', ['--sdk', sdk, '--show-sdk-path'], {
      encoding: 'utf8',
    }).trim();
    run('cmake', [
      '-S',
      source,
      '-B',
      build,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DCMAKE_SYSTEM_NAME=iOS',
      `-DCMAKE_OSX_SYSROOT=${sdkPath}`,
      `-DCMAKE_OSX_ARCHITECTURES=${arch}`,
      `-DCMAKE_SYSTEM_PROCESSOR=${arch}`,
      '-DCMAKE_OSX_DEPLOYMENT_TARGET=15.1',
      '-DJNBOT_MOBILE=ON',
        `-DNODE_INCLUDE_DIR=${headers}`,
    ]);
    run('cmake', ['--build', build, '--target', 'jnbot_inference', '-j', '4']);
    const archives = [];
    const walk = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith('.a')) archives.push(file);
      });
    };
    walk(build);
    // CocoaPods requires every XCFramework slice to have the same binary name.
    const slice = path.join(directory, `${sdk}-${arch}`);
    fs.mkdirSync(slice, { recursive: true });
    const library = path.join(slice, 'libJNbotInference.a');
    run('xcrun', ['libtool', '-static', '-o', library, ...archives]);
    libraries.push(library);
  });
  const simulatorDirectory = path.join(directory, 'simulator');
  fs.mkdirSync(simulatorDirectory, { recursive: true });
  const simulator = path.join(simulatorDirectory, 'libJNbotInference.a');
  run('xcrun', [
    'lipo',
    '-create',
    libraries[1],
    libraries[2],
    '-output',
    simulator,
  ]);
  const framework = path.join(directory, 'JNbotInference.xcframework');
  const temporary = path.join(directory, 'JNbotInference.tmp.xcframework');
  fs.rmSync(temporary, { recursive: true, force: true });
  run('xcodebuild', [
    '-create-xcframework',
    '-library',
    libraries[0],
    '-library',
    simulator,
    '-output',
    temporary,
  ]);
  fs.rmSync(framework, { recursive: true, force: true });
  fs.renameSync(temporary, framework);
  fs.writeFileSync(
    path.join(directory, 'ios-build.json'),
    `${JSON.stringify({ fingerprint: key })}\n`,
  );
}
notices(directory);
process.stdout.write(`Prepared mobile inference: ${directory}\n`);
