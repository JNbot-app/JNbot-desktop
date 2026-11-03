import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import esbuild from 'esbuild';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-export-flash-'));
try {
  const output = path.join(temporary, 'export.cjs');
  esbuild.buildSync({
    entryPoints: [fileURLToPath(new URL('./export-flash.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: output,
  });
  execFileSync(process.execPath, [output, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
