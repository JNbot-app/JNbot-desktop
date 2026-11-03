#!/usr/bin/env node
/**
 * Sign a `.jnp` plugin export so that JNbot will mark it as `verified`
 * on import (and skip the "unverified plugin" warning).
 *
 * Reads an existing `{ info, code }` export and writes a copy with an
 * converted to the version-2 Ed25519 package format used by the app.
 *
 * Usage:
 *   node scripts/sign-plugin.mjs <input.jnp> [--out <path>]
 *
 * Signing key:
 *   scripts/keys/plugins.ed25519.private.pem  (gitignored — keep secret)
 *   Generate with:
 *     node scripts/generate-plugin-signing-key.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalJson, signPlugin } from './plugin-signing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY_PATH = path.join(__dirname, 'keys', 'plugins.ed25519.private.pem');

// ---- Args ---------------------------------------------------------------
const argv = process.argv.slice(2);
if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node scripts/sign-plugin.mjs <input.jnp> [--out <path>]');
  process.exit(argv.length ? 0 : 1);
}

const inputPath = path.resolve(argv[0]);
const outIdx = argv.indexOf('--out');
const outPath = outIdx >= 0
  ? path.resolve(argv[outIdx + 1])
  : inputPath.replace(/\.jnp$/i, '.signed.jnp');

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}
if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error(`Private key not found at ${PRIVATE_KEY_PATH}.`);
  process.exit(1);
}

// ---- Work ---------------------------------------------------------------
const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!raw?.info || !raw?.code) {
  console.error('Input file is missing { info, code }');
  process.exit(1);
}

const bundle = signPlugin(
  raw.info,
  raw.code,
  fs.readFileSync(PRIVATE_KEY_PATH, 'utf8'),
  process.env.JNBOT_PUBLISHER_NAME || 'JNbot Official',
);
const digest = createHash('sha256')
  .update(
    canonicalJson({
      ...bundle,
      signature: { ...bundle.signature, value: undefined },
    }),
  )
  .digest('base64url');

fs.writeFileSync(outPath, JSON.stringify(bundle));

console.log(`Signed "${raw.info?.name ?? raw.info?.pluginId ?? 'plugin'}"`);
console.log(`  out      ${outPath}`);
console.log(`  digest   ${digest}`);
console.log(`  sig      ${bundle.signature.value.slice(0, 32)}…`);
