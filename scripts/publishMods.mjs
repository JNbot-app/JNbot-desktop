#!/usr/bin/env node
/**
 * Build the JNbot Fabric mod for every supported Minecraft version and publish
 * it to the `jnbot-mods` branch of the JNbot-updater repo.
 *
 * Branch layout (served by the Cloudflare proxy under `/mods/...`):
 *   manifest.json              { versions: { "<mc>": { version, filename, sha1, libraries } } }
 *   <mc>/jnbot-fabric-<mod>+<mc>.jar
 *
 * The manifest entry for a Minecraft version always points at the newest mod
 * build for it, so clients pick up new releases without an app update. Jars are
 * never overwritten (their URLs are cached as immutable): re-publishing changed
 * code under an existing `mod.version` fails — bump it in
 * minecraft-mods/jnbot-fabric/stonecutter.properties.toml.
 *
 * The branch is checked out in a temporary git worktree, so the updater
 * checkout is left untouched.
 *
 * Usage:
 *   GH_TOKEN=... node scripts/publishMods.mjs
 *   GH_TOKEN=... node scripts/publishMods.mjs --dry-run      # commit locally, no push
 *   GH_TOKEN=... node scripts/publishMods.mjs --skip-build   # reuse build/libs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOD_ROOT = path.join(__dirname, '..', 'minecraft-mods', 'jnbot-fabric');
const LIBS_DIR = path.join(MOD_ROOT, 'build', 'libs');
const UPDATER_ROOT = path.join(__dirname, 'JNbot-updater');
const REPO = 'usserwout/JNbot-updater';
const BRANCH = 'jnbot-mods';
const JAR_RE = /^jnbot-fabric-(\d+\.\d+\.\d+)\+(.+)\.jar$/;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const skipBuild = argv.includes('--skip-build');

const token = process.env.GH_TOKEN;
const remote = token ? `https://${token}@github.com/${REPO}.git` : 'origin';

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
const out = (cmd, cwd) => {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const sha1 = (file) =>
  crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

const compareVersions = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

/** Minimal reader for stonecutter.properties.toml: flat `key = "value"` pairs per `["<mc>"]` section. */
function readModProperties() {
  const toml = fs.readFileSync(path.join(MOD_ROOT, 'stonecutter.properties.toml'), 'utf8');
  const sections = { '': {} };
  let current = '';
  for (const line of toml.split('\n')) {
    const section = /^\["(.+)"\]\s*$/.exec(line);
    if (section) {
      current = section[1];
      sections[current] = {};
      continue;
    }
    const pair = /^([\w.]+)\s*=\s*"([^"]*)"/.exec(line);
    if (pair) sections[current][pair[1]] = pair[2];
  }
  return (mc) => ({ ...sections[''], ...sections[mc] });
}

/** Pinned Fabric API jar for a Minecraft version, as a launcher library artifact. */
async function fabricApiLibrary(mc, fabricApiVersion) {
  const query = `game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent('["fabric"]')}`;
  const res = await fetch(`https://api.modrinth.com/v2/project/fabric-api/version?${query}`, {
    headers: { 'User-Agent': 'JNbot (publishMods)' },
  });
  if (!res.ok) throw new Error(`Modrinth request failed (${res.status})`);
  const version = (await res.json()).find((v) => v.version_number === fabricApiVersion);
  const file = version?.files.find((f) => f.primary) ?? version?.files[0];
  if (!file) throw new Error(`Fabric API ${fabricApiVersion} not found on Modrinth for ${mc}`);
  return {
    filename: file.filename,
    url: file.url,
    hashes: { sha1: file.hashes.sha1 },
    destination: `libraries/net/fabricmc/fabric-api/${mc}`,
  };
}

// 1. Build every version.
if (!skipBuild) run('bash build.sh', MOD_ROOT);
const jars = fs.existsSync(LIBS_DIR)
  ? fs.readdirSync(LIBS_DIR).filter((name) => JAR_RE.test(name))
  : [];
if (jars.length === 0) throw new Error(`No mod jars found in ${LIBS_DIR}`);

// 2. Check out the branch in a temporary worktree (orphan on first publish).
const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'publishMods-'));
process.on('exit', () => out(`git worktree remove --force ${JSON.stringify(worktree)}`, UPDATER_ROOT));
fs.rmSync(worktree, { recursive: true });

const remoteHasBranch = out(`git ls-remote --heads ${remote} ${BRANCH}`, UPDATER_ROOT) !== '';
if (remoteHasBranch) {
  run(`git fetch ${remote} refs/heads/${BRANCH}`, UPDATER_ROOT);
  run(`git worktree add --force -B ${BRANCH} ${JSON.stringify(worktree)} FETCH_HEAD`, UPDATER_ROOT);
} else {
  out(`git branch -D ${BRANCH}`, UPDATER_ROOT); // leftover from an unpushed --dry-run
  run(`git worktree add --force --orphan -b ${BRANCH} ${JSON.stringify(worktree)}`, UPDATER_ROOT);
}

// 3. Add the jars and point each Minecraft version at its newest build.
const manifestPath = path.join(worktree, 'manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { versions: {} };
const propsFor = readModProperties();

for (const filename of jars) {
  const [, version, mc] = JAR_RE.exec(filename);
  const source = path.join(LIBS_DIR, filename);
  const destination = path.join(worktree, mc, filename);
  const hash = sha1(source);

  if (fs.existsSync(destination) && sha1(destination) !== hash) {
    throw new Error(
      `${filename} is already published with different content — bump mod.version in stonecutter.properties.toml.`,
    );
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);

  const current = manifest.versions[mc];
  if (current && compareVersions(version, current.version) < 0) {
    console.log(`Skipping manifest update for ${mc}: ${current.version} is newer than ${version}.`);
    continue;
  }
  manifest.versions[mc] = {
    version,
    filename,
    sha1: hash,
    libraries: [await fabricApiLibrary(mc, propsFor(mc)['deps.fabric_api'])],
  };
  console.log(`${mc} -> ${filename}`);
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// 4. Commit + push.
run('git add -A', worktree);
if (out('git diff --cached --name-only', worktree) === '') {
  console.log(`\nNothing changed — ${BRANCH} is already up to date.`);
  process.exit(0);
}
run(`git commit -m ${JSON.stringify(`JNbot mods: ${jars.join(', ')}`)}`, worktree);

if (dryRun) {
  console.log(`\n--dry-run: committed locally on ${BRANCH}; skipping push.`);
  process.exit(0);
}
if (!token) console.warn('\nGH_TOKEN not set — pushing with the existing `origin` credentials.');
run(`git push ${remote} refs/heads/${BRANCH}:refs/heads/${BRANCH}`, worktree);
console.log(`\nPublished ${jars.length} mod jar(s) to branch ${BRANCH}.`);
