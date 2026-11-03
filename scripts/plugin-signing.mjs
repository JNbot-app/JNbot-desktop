import crypto from 'node:crypto';

export const PLUGIN_BUNDLE_FORMAT = 'jnbot-plugin';
export const PLUGIN_BUNDLE_VERSION = 2;

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = normalize(value[key]);
    }
    return result;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function exportablePluginInfo(info) {
  const portable = { ...info };
  delete portable.trust;
  delete portable.security;
  delete portable.downloads;
  delete portable.folder;
  delete portable.profile;
  delete portable.containsDeveloperCode;
  return { ...portable, public: false, editedAt: null };
}

export function signPlugin(
  info,
  code,
  privateKey,
  publisherName = 'JNbot Official',
  signedAt = new Date().toISOString(),
) {
  const publicKey = crypto
    .createPublicKey(privateKey)
    .export({ type: 'spki', format: 'der' })
    .toString('base64url');
  const portableInfo = exportablePluginInfo(info);
  const unsigned = {
    algorithm: 'ed25519',
    publicKey,
    publisherName,
    signedAt,
  };
  const payload = {
    format: PLUGIN_BUNDLE_FORMAT,
    version: PLUGIN_BUNDLE_VERSION,
    info: portableInfo,
    code,
    signature: unsigned,
  };
  return {
    ...payload,
    signature: {
      ...unsigned,
      value: crypto
        .sign(null, Buffer.from(canonicalJson(payload)), privateKey)
        .toString('base64url'),
    },
  };
}
