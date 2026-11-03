import { app } from 'electron';
import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import axios from 'axios';

// Windows "resources update": instead of running the (unsigned) NSIS installer,
// download a zip of the resources folder (app.asar, workers, assets, needle),
// stage it next to the installed one and swap the folders after the app quits.
// Any failure returns/throws so the caller falls back to the full installer.

const RELEASES_URL = 'https://github.com/usserwout/JNbot-updater/releases/download';
const resourcesDir = process.resourcesPath;
const stagedDir = `${resourcesDir}.new`;
const downloadDir = `${resourcesDir}.download`;
const markerName = '.jnbot-update';
// Written by the apply script when the swap fails; its first line is the sha of
// the staged update, which then goes through the full installer instead.
const failedLog = `${resourcesDir}-update-error.log`;

type Manifest = {
  version: string;
  electron: string;
  file: string;
  size: number;
  sha512: string;
};

let pending: Promise<boolean> | undefined;
let applying = false;

// Electron's fs treats app.asar as a directory, which breaks recursive removes.
function removeDir(dir: string) {
  const noAsar = process.noAsar;
  process.noAsar = true;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } finally {
    process.noAsar = noAsar;
  }
}

/** Resolves true once the update is staged, false when a full installer update is needed. */
export function downloadResourcesUpdate(
  version: string,
  onProgress: (percent: number) => void,
) {
  pending ??= stage(version, onProgress).finally(() => (pending = undefined));
  return pending;
}

async function stage(version: string, onProgress: (percent: number) => void) {
  const manifest = await axios
    .get<Manifest>(`${RELEASES_URL}/v${version}/resources-win.json`, { timeout: 15_000 })
    .then((res) => res.data)
    .catch(() => null);
  if (!manifest?.sha512 || manifest.electron !== process.versions.electron)
    return false;

  // A previous swap of this update failed (e.g. files in use), don't loop on it.
  if (fs.existsSync(failedLog) && fs.readFileSync(failedLog, 'utf8').startsWith(manifest.sha512)) {
    removeDir(stagedDir);
    return false;
  }

  const marker = path.join(stagedDir, markerName);
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === manifest.sha512)
    return true;

  for (const dir of [downloadDir, stagedDir, `${resourcesDir}.old`]) removeDir(dir);
  // Throws EPERM for Program Files (per-machine) installs.
  fs.mkdirSync(downloadDir);

  const zipPath = path.join(downloadDir, manifest.file);
  await download(
    `${RELEASES_URL}/v${version}/${manifest.file}`,
    zipPath,
    manifest,
    onProgress,
  );

  const extractDir = path.join(downloadDir, 'resources');
  fs.mkdirSync(extractDir);
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  await promisify(execFile)(tar, ['-xf', zipPath, '-C', extractDir], {
    windowsHide: true,
    timeout: 120_000,
  });

  // elevate.exe isn't shipped in the zip, keep the installed one.
  const elevate = path.join(resourcesDir, 'elevate.exe');
  if (fs.existsSync(elevate)) fs.copyFileSync(elevate, path.join(extractDir, 'elevate.exe'));

  fs.writeFileSync(path.join(extractDir, markerName), manifest.sha512);
  fs.renameSync(extractDir, stagedDir);
  removeDir(downloadDir);
  return true;
}

async function download(
  url: string,
  file: string,
  manifest: Manifest,
  onProgress: (percent: number) => void,
) {
  const res = await axios.get(url, { responseType: 'stream', timeout: 30_000 });
  const hash = crypto.createHash('sha512');
  let received = 0;
  let lastPercent = 0;

  // Abort a stalled download so the caller can fall back to the installer.
  let stall: NodeJS.Timeout | undefined;
  const resetStall = () => {
    clearTimeout(stall);
    stall = setTimeout(
      () => res.data.destroy(new Error('Resources update download stalled')),
      60_000,
    );
  };
  resetStall();
  res.data.on('data', (chunk: Buffer) => {
    resetStall();
    hash.update(chunk);
    received += chunk.length;
    const percent = Math.floor((received / manifest.size) * 100);
    if (percent > lastPercent) onProgress((lastPercent = percent));
  });
  try {
    await pipeline(res.data, fs.createWriteStream(file));
  } finally {
    clearTimeout(stall);
  }

  if (hash.digest('base64') !== manifest.sha512)
    throw new Error('Resources update checksum mismatch');
}

// Runs as plain Node (ELECTRON_RUN_AS_NODE) from the temp dir once JNbot has
// exited, so nothing holds the resources folder open. Rolls back on failure,
// writing the update's sha to the error log so it isn't retried, and always
// relaunches JNbot.
const APPLY_SCRIPT = `
process.noAsar = true;
const fs = require('fs');
const { spawn } = require('child_process');
const [pid, res, exe] = process.argv.slice(2);
const next = res + '.new', old = res + '.old';
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = () => { try { process.kill(+pid, 0); return true; } catch { return false; } };
const retry = (fn) => { for (let i = 0; ; i++) { try { return fn(); } catch (e) { if (i >= 40) throw e; sleep(250); } } };

for (let i = 0; alive() && i < 240; i++) sleep(250);
if (alive()) process.exit(1);

let sha = '';
try { sha = fs.readFileSync(next + '/${markerName}', 'utf8'); } catch {}
try {
  fs.rmSync(old, { recursive: true, force: true });
  retry(() => fs.renameSync(res, old));
  try {
    retry(() => fs.renameSync(next, res));
  } catch (e) {
    retry(() => fs.renameSync(old, res));
    throw e;
  }
  try { fs.rmSync(old, { recursive: true, force: true }); } catch {}
} catch (e) {
  try { fs.writeFileSync(res + '-update-error.log', sha + '\\n' + String((e && e.stack) || e)); } catch {}
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(exe, [], { detached: true, stdio: 'ignore', env }).unref();
`;

export function applyResourcesUpdate() {
  if (applying) return;
  applying = true;
  const script = path.join(app.getPath('temp'), 'jnbot-apply-update.js');
  fs.writeFileSync(script, APPLY_SCRIPT);
  spawn(process.execPath, [script, String(process.pid), resourcesDir, process.execPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).unref();
  app.quit();
}
