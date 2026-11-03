import {
  SHARE_REQUEST_MAX_SKEW,
  shareRequestMessage,
} from '../../../src/common/share';

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export async function sha256Hex(value: ArrayBuffer | Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyEd25519(
  publicKey: string,
  signature: string,
  message: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      base64UrlToBytes(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

export const isOfficialKey = (env: Env, key: string): boolean =>
  (env.OFFICIAL_PUBLIC_KEYS ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes(key);

/**
 * Publisher key of a signed request, or null when the signature,
 * timestamp or body hash does not check out.
 */
export async function signedRequestKey(
  request: Request,
  path: string,
  body: ArrayBuffer,
): Promise<string | null> {
  const key = request.headers.get('x-jnbot-key');
  const signature = request.headers.get('x-jnbot-signature');
  const nonce = request.headers.get('x-jnbot-nonce');
  const timestamp = Number(request.headers.get('x-jnbot-timestamp'));
  if (
    !key ||
    key.length > 200 ||
    !signature ||
    !nonce ||
    nonce.length > 100 ||
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() - timestamp) > SHARE_REQUEST_MAX_SKEW
  ) {
    return null;
  }
  const message = shareRequestMessage(
    request.method,
    path,
    timestamp,
    nonce,
    await sha256Hex(body),
  );
  return (await verifyEd25519(key, signature, message)) ? key : null;
}
