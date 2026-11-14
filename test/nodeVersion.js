/* eslint-disable no-console */
// Keep this file parseable by old Node: it runs before the re-exec.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Re-runs `script` under an nvm-installed Node >= `minMajor` when the current
 * one is older (the default PATH node may be 14). Exits with its status.
 */
function ensureNode(minMajor, script) {
  const currentMajor = Number(process.versions.node.split('.')[0]);
  if (currentMajor >= minMajor) return;
  const nvm = path.join(process.env.HOME || '', '.nvm', 'versions', 'node');
  const candidate = fs.existsSync(nvm)
    ? fs.readdirSync(nvm)
      .map((version) => path.join(nvm, version, 'bin', 'node'))
      .find((binary) => fs.existsSync(binary) && Number(execFileSync(binary, ['-p', 'process.versions.node.split(".")[0]'], { encoding: 'utf8' })) >= minMajor)
    : undefined;
  if (!candidate) throw new Error(`This needs Node ${minMajor}+ (current: ${process.versions.node}).`);
  const result = spawnSync(candidate, [script, ...process.argv.slice(2)], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}

module.exports = { ensureNode };
