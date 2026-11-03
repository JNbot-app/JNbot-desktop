// Publishes the Windows "resources update": a zip of win-unpacked/resources plus a
// manifest. The app swaps its resources folder with this instead of running the
// NSIS installer, as long as the Electron version matches (see src/main/winResourcesUpdate.ts).
//
// Set JNBOT_FULL_UPDATE=1 to skip it and force everyone onto the full installer.
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { version } = require(path.join(root, 'release/app/package.json'));
const electron = require('electron/package.json').version;

if (process.env.JNBOT_FULL_UPDATE === '1') {
  console.log('[win-resources] JNBOT_FULL_UPDATE=1, skipping (full installer update)');
  process.exit(0);
}

const buildDir = path.join(root, 'release/build');
const resourcesDir = path.join(buildDir, 'win-unpacked/resources');
if (!fs.existsSync(resourcesDir)) throw new Error(`Missing ${resourcesDir}`);

const file = `JNbot-${version}-win-x64-resources.zip`;
const zipPath = path.join(buildDir, file);
const manifestPath = path.join(buildDir, 'resources-win.json');

// elevate.exe stays out: the app keeps its installed copy, and shipping an
// unsigned exe is what antivirus flags.
const zip = new AdmZip();
zip.addLocalFolder(resourcesDir, '', (name) => path.basename(name) !== 'elevate.exe');
zip.writeZip(zipPath);

const data = fs.readFileSync(zipPath);
const manifest = {
  version,
  electron,
  file,
  size: data.length,
  sha512: crypto.createHash('sha512').update(data).digest('base64'),
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('[win-resources]', manifest);

// Upload the zip first so a visible manifest always has its zip.
for (const asset of [zipPath, manifestPath]) {
  execFileSync(
    'gh',
    ['release', 'upload', `v${version}`, asset, '--repo', 'usserwout/JNbot-updater', '--clobber'],
    { stdio: 'inherit' },
  );
}
