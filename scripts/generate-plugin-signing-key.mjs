#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'keys');
const privatePath = path.join(directory, 'plugins.ed25519.private.pem');
if (fs.existsSync(privatePath)) {
  console.error(`Refusing to replace existing key: ${privatePath}`);
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
fs.writeFileSync(
  privatePath,
  privateKey.export({ type: 'pkcs8', format: 'pem' }),
  { mode: 0o600 },
);
console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'));
console.error(`Created ${privatePath}. Back it up securely; it cannot be recovered.`);
