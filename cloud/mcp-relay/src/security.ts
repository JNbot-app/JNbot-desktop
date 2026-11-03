export function base64UrlToBytes(value: string): ArrayBuffer {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  );
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
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
    return crypto.subtle.verify(
      'Ed25519',
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

export function secureJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
    },
  });
}

export function validInstallationId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}
