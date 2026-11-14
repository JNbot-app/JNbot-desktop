/* eslint-disable no-console */
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const { ensureNode } = require('../nodeVersion');

const ROOT = path.resolve(__dirname, '..', '..');
ensureNode(22, __filename);

execFileSync(process.execPath, ['esbuild/esbuild.config.main.prod.js'], { cwd: ROOT, stdio: 'inherit' });
const mode = process.argv[2] || '--core';
const files = mode === '--scripts'
  ? ['test/protocol/generated-script-behavior.test.js']
  : ['test/protocol/semantic-scenario.test.js', 'test/protocol/protocol-versions.test.js'];
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(result.status ?? 1);
