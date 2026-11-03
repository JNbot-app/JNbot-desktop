const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = function copyNeedle(output) {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'assets', 'needle');
  const target = `${process.platform}-${process.arch}`;
  execFileSync(
    process.execPath,
    [path.join(root, 'scripts', 'build-needle.mjs')],
    { stdio: 'inherit' },
  );
  const destination = path.join(output, 'needle');
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(
    path.join(source, 'runtime.cjs'),
    path.join(destination, 'runtime.cjs'),
  );
  fs.copyFileSync(
    path.join(source, 'worker.cjs'),
    path.join(destination, 'worker.cjs'),
  );
  fs.cpSync(path.join(source, 'notices'), path.join(destination, 'notices'), {
    recursive: true,
  });
  fs.cpSync(path.join(source, target), path.join(destination, target), {
    recursive: true,
  });
};
