import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronPath = require('electron');
const vitePath = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const children = [];
let shuttingDown = false;

const start = (command, args, env = process.env) => {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  children.push(child);
  return child;
};

const stop = (signal = 'SIGTERM') => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
};

const waitForOutput = (child, text) =>
  new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk) => {
      output = (output + chunk).slice(-2048);
      if (output.includes(text)) {
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) =>
      reject(new Error(`Main build exited with code ${code}`)),
    );
  });

const waitForRenderer = (child) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + 120_000;
    const check = () => {
      const request = http.get('http://localhost:1212/', (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else retry();
      });
      request.on('error', retry);
      request.setTimeout(1_000, () => request.destroy());
    };
    const retry = () => {
      if (Date.now() >= deadline) {
        reject(
          new Error('Renderer server did not become ready within 120 seconds'),
        );
      } else {
        setTimeout(check, 100);
      }
    };
    child.once('exit', (code) =>
      reject(new Error(`Renderer server exited with code ${code}`)),
    );
    check();
  });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stop(signal);
    process.exit(0);
  });
}

const mainBuilder = start(process.execPath, ['esbuild/esbuild.config.main.js']);
const mainReady = waitForOutput(mainBuilder, 'Main process ready');
const renderer = start(process.execPath, [
  vitePath,
  'serve',
  'src/renderer',
  '--port',
  '1212',
  '--strictPort',
]);

try {
  await Promise.all([mainReady, waitForRenderer(renderer)]);
  console.log("Continuing...")
  
  const electron = start(electronPath, [ './release/app/dist/main/main.js'], {
    ...process.env,
    NODE_ENV: 'development',
    INSTALL_EXTENSIONS: process.env.INSTALL_EXTENSIONS ?? 'false',
  });
  electron.once('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exit(1);
}
