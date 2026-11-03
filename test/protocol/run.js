/* eslint-disable no-console */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const minMajor = 22;
const currentMajor = Number(process.versions.node.split('.')[0]);

if (currentMajor < minMajor) {
  const nvm = path.join(process.env.HOME || '', '.nvm', 'versions', 'node');
  const candidate = fs.existsSync(nvm)
    ? fs.readdirSync(nvm)
      .map((version) => path.join(nvm, version, 'bin', 'node'))
      .find((binary) => fs.existsSync(binary) && Number(execFileSync(binary, ['-p', 'process.versions.node.split(".")[0]'], { encoding: 'utf8' })) >= minMajor)
    : undefined;
  if (!candidate) throw new Error(`Offline bot tests require Node ${minMajor}+ (current: ${process.versions.node}).`);
  const result = spawnSync(candidate, [__filename, ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

execFileSync(process.execPath, ['esbuild/esbuild.config.main.prod.js'], { cwd: ROOT, stdio: 'inherit' });
const mode = process.argv[2] || '--core';
const files = mode === '--scripts'
  ? ['test/protocol/generated-script-behavior.test.js']
  : ['test/protocol/semantic-scenario.test.js', 'test/protocol/protocol-versions.test.js'];
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(result.status ?? 1);
