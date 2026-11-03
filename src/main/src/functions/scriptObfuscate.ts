import zlib from 'zlib';
import crypto from 'crypto';

/**
 * Lightweight obfuscation for script code stored on disk or embedded in
 * exported profiles. The flow is: canonical-JSON → gzip → XOR with a
 * static key → base64 (for transport) / raw bytes (for disk).
 *
 * Threat model: stop casual users from running `cat <file>` and seeing the
 * source. Anyone running the app can still log the deobfuscated value at
 * eval time. Per the user's explicit guidance: avoid real encryption — a
 * key shipped in the binary buys nothing over obfuscation.
 *
 * Checksums are computed against the *plaintext* canonical JSON so the
 * signature workflow is independent of the obfuscation scheme.
 */
const XOR_KEY = Buffer.from(
  'jnbot/profileScripts/xor-pad/2025/keep-this-stable-or-bundles-break',
  'utf8',
);

function xor(buf: Buffer): Buffer {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ XOR_KEY[i % XOR_KEY.length];
  }
  return out;
}

/** Serialise code → canonical JSON bytes. Shared so checksum + obfuscation agree. */
export function canonicalCodeBytes(code: unknown): Buffer {
  return Buffer.from(JSON.stringify(code), 'utf8');
}

/** SHA-256 hex over the canonical plaintext form. */
export function checksumOfCode(code: unknown): string {
  return crypto.createHash('sha256').update(canonicalCodeBytes(code)).digest('hex');
}

/** Plain code → obfuscated bytes (write directly to disk). */
export function obfuscateCode(code: unknown): Buffer {
  const compressed = zlib.gzipSync(canonicalCodeBytes(code));
  return xor(compressed);
}

/** Obfuscated bytes → plain code object. */
export function deobfuscateCode(buf: Buffer): unknown {
  const compressed = xor(buf);
  const plain = zlib.gunzipSync(compressed);
  return JSON.parse(plain.toString('utf8'));
}

/** Convenience: obfuscated → base64 string (used for embedding in JSON exports). */
export function obfuscateCodeToBase64(code: unknown): string {
  return obfuscateCode(code).toString('base64');
}

/** Convenience inverse — accepts a base64 string. */
export function deobfuscateCodeFromBase64(b64: string): unknown {
  return deobfuscateCode(Buffer.from(b64, 'base64'));
}

/**
 * Normalise a parsed `.jnp` payload. When the bundle ships its code
 * obfuscated (a `codeObf` base64 string instead of a plain `code` object —
 * see `build-jndata.mjs --obfuscate`), decode it back into a plain `code`
 * field. Plaintext payloads pass through untouched, so the rest of the
 * load/validate pipeline never has to know whether obfuscation was used.
 */
export function inflatePluginPayload<T>(raw: T): T {
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as { codeObf?: unknown }).codeObf === 'string' &&
    (raw as { code?: unknown }).code === undefined
  ) {
    const { codeObf, ...rest } = raw as Record<string, unknown> & {
      codeObf: string;
    };
    return { ...rest, code: deobfuscateCodeFromBase64(codeObf) } as T;
  }
  return raw;
}
