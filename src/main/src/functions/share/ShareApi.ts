import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { app } from 'electron';
import {
  MAX_BANNER_BYTES,
  MAX_BANNER_URL_LENGTH,
  MAX_UNPACKED_SHARE_BYTES,
  SHARE_ORIGIN,
  shareRequestMessage,
  sniffImageType,
} from '../../../../common/share';
import { pluginSecurity } from '../signing';

/** `JNBOT_SHARE_ORIGIN` points dev builds at `wrangler dev`. */
export const shareOrigin = (): string =>
  (!app.isPackaged && process.env.JNBOT_SHARE_ORIGIN) || SHARE_ORIGIN;

export const sha256Hex = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

interface RequestOptions {
  body?: string | Buffer;
  contentType?: string;
  /** Sign with the publisher key (writes, reviews, reports). */
  signed?: boolean;
  headers?: Record<string, string>;
}

/** One request to the share Worker; throws `{status}` errors with the Worker's message. */
export async function shareRequest(
  method: string,
  path: string,
  { body = '', contentType = 'application/json', signed = false, headers = {} }: RequestOptions = {},
): Promise<Response> {
  const allHeaders: Record<string, string> = { 'content-type': contentType, ...headers };
  if (signed) {
    const timestamp = Date.now();
    const nonce = randomUUID();
    const { publicKey, signature } = pluginSecurity().signMessage(
      shareRequestMessage(method, path, timestamp, nonce, sha256Hex(body)),
    );
    Object.assign(allHeaders, {
      'x-jnbot-key': publicKey,
      'x-jnbot-timestamp': String(timestamp),
      'x-jnbot-nonce': nonce,
      'x-jnbot-signature': signature,
    });
  }
  const response = await fetch(`${shareOrigin()}${path}`, {
    method,
    headers: allHeaders,
    body: !body.length ? undefined : typeof body === 'string' ? body : new Uint8Array(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 304) {
    const message = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
    throw Object.assign(new Error(message ?? `Share service error (${response.status})`), {
      status: response.status,
    });
  }
  return response;
}

/** Serialized multipart body, so the signed hash matches the bytes sent. */
export async function multipart(fields: Record<string, string | Buffer | null>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === null) continue;
    form.set(name, typeof value === 'string' ? value : new Blob([new Uint8Array(value)]));
  }
  const serialized = new Response(form);
  return {
    body: Buffer.from(await serialized.arrayBuffer()),
    contentType: serialized.headers.get('content-type')!,
  };
}

export const packContent = (text: string): Buffer => gzipSync(text);

export function unpackContent(content: Buffer): string {
  try {
    return gunzipSync(content, { maxOutputLength: MAX_UNPACKED_SHARE_BYTES }).toString('utf8');
  } catch {
    throw new Error('This share is damaged or too large to open.');
  }
}

/**
 * Banner bytes from a data URI, so the marketplace hosts it. Anything that is
 * not a small PNG/JPEG/WebP/GIF is skipped: the banner is optional. Banner
 * URLs are not uploaded; the listing links them (see {@link bannerLink}).
 */
export function loadBanner(source: string | null | undefined): Buffer | null {
  const dataUri = source && /^data:image\/[a-z+]+;base64,(.+)$/i.exec(source);
  const bytes = dataUri ? Buffer.from(dataUri[1], 'base64') : null;
  return bytes && bytes.byteLength <= MAX_BANNER_BYTES && sniffImageType(bytes) ? bytes : null;
}

/** A banner given as an image URL, linked from the listing instead of uploaded. */
export const bannerLink = (source: string | null | undefined): string | undefined =>
  source && /^https?:\/\/\S+$/i.test(source) && source.length <= MAX_BANNER_URL_LENGTH ? source : undefined;
