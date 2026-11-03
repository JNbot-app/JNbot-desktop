#!/usr/bin/env node
/**
 * Take an existing `.jnp` export ({ info, code }) and produce a signed
 * profile-script bundle ready to ship.
 *
 * Outputs three things next to the input file (or to --out):
 *   <pluginId>.info.json   plain JSON, copied straight from the input
 *   <pluginId>.code.jnc    obfuscated bytes (gzip + XOR; see
 *                          src/main/src/functions/scriptObfuscate.ts)
 *   <pluginId>.profileScript.json
 *                          ready-to-paste `ProfileScript` entry, with
 *                          absolute infoPath/codePath, checksum, and
 *                          signature.
 *
 * Usage:
 *   node scripts/sign-profile-script.mjs <input.jnp> [--out <dir>]
 *
 * Signing key:
 *   scripts/keys/plugins.ed25519.private.pem (gitignored — keep secret)
 *
 * The XOR pad + algorithm must stay in sync with
 * `src/main/src/functions/scriptObfuscate.ts`. If you rotate either,
 * rotate both.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { signPlugin } from './plugin-signing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Constants (kept in sync with scriptObfuscate.ts) -------------------
const XOR_KEY = Buffer.from(
  'jnbot/profileScripts/xor-pad/2025/keep-this-stable-or-bundles-break',
  'utf8',
);
const PRIVATE_KEY_PATH = path.join(__dirname, 'keys', 'plugins.ed25519.private.pem');

// ---- Helpers ------------------------------------------------------------
function xor(buf) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ XOR_KEY[i % XOR_KEY.length];
  return out;
}

function canonicalCodeBytes(code) {
  return Buffer.from(JSON.stringify(code), 'utf8');
}

function checksumOfCode(code) {
  return crypto.createHash('sha256').update(canonicalCodeBytes(code)).digest('hex');
}

function obfuscateCode(code) {
  return xor(zlib.gzipSync(canonicalCodeBytes(code)));
}

// ---- Args ---------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  console.log(
    'usage: node scripts/sign-profile-script.mjs <input.jnp> [--out <dir>]',
  );
  process.exit(argv.length === 0 ? 1 : 0);
}

const inputPath = argv[0];
const outIdx = argv.indexOf('--out');
const outDir = outIdx >= 0 ? argv[outIdx + 1] : path.dirname(path.resolve(inputPath));

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}
if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error(
    `Private key not found at ${PRIVATE_KEY_PATH}.\n` +
      `Generate one with:\n` +
      `  node scripts/generate-plugin-signing-key.mjs`,
  );
  process.exit(1);
}

// ---- Work ---------------------------------------------------------------
const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!raw?.info?.pluginId || !raw?.code) {
  console.error('Input file is missing { info.pluginId, code }');
  process.exit(1);
}

const { info, code } = raw;
const pluginId = info.pluginId;
const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

const checksum = checksumOfCode(code);
const signature = signPlugin(
  info,
  code,
  privateKey,
  process.env.JNBOT_PUBLISHER_NAME || 'JNbot Official',
).signature;

fs.mkdirSync(outDir, { recursive: true });
const absOutDir = path.resolve(outDir);
const infoPath = path.join(absOutDir, `${pluginId}.info.json`);
const codePath = path.join(absOutDir, `${pluginId}.code.jnc`);
const entryPath = path.join(absOutDir, `${pluginId}.profileScript.json`);

fs.writeFileSync(infoPath, JSON.stringify(info));
fs.writeFileSync(codePath, obfuscateCode(code));

const profileScript = {
  id: `s_${pluginId}`,
  pluginId,
  source: {
    kind: 'bundled',
    infoPath,
    codePath,
  },
  checksum,
  signature,
};
fs.writeFileSync(entryPath, JSON.stringify(profileScript, null, 2));

console.log(`Signed "${info.name ?? pluginId}"`);
console.log(`  info     ${infoPath}`);
console.log(`  code     ${codePath}`);
console.log(`  entry    ${entryPath}`);
console.log(`  checksum ${checksum}`);
console.log(`  sig      ${signature.value.slice(0, 32)}…`);
