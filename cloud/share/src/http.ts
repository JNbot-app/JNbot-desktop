import { MAX_SHARE_BYTES, MAX_BANNER_BYTES, MAX_LISTING_BYTES } from '../../../src/common/share';
import { signedRequestKey } from './auth';

export const API_HEADERS = {
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, {
    status,
    headers: { 'cache-control': 'no-store', ...API_HEADERS, ...headers },
  });
}

export const error = (status: number, message: string) =>
  json({ error: message }, status);

const ip = (request: Request) => request.headers.get('cf-connecting-ip') ?? 'unknown';

/** Per-IP read limit; null when allowed. Optional so the vitest pool can run without it. */
export async function readLimited(request: Request, env: Env): Promise<Response | null> {
  const limit = await env.READ_LIMITER?.limit({ key: ip(request) });
  return limit && !limit.success ? error(429, 'Too many requests, try again in a minute') : null;
}

// A full write: gzip + banner + listing + multipart overhead.
const MAX_WRITE_BYTES = MAX_SHARE_BYTES + MAX_BANNER_BYTES + MAX_LISTING_BYTES + 4096;

export interface SignedWrite {
  key: string;
  body: ArrayBuffer;
}

/** Rate limit, size cap and signature check shared by every signed request. */
export async function readSignedWrite(
  request: Request,
  env: Env,
  path: string,
): Promise<SignedWrite | Response> {
  const limit = await env.WRITE_LIMITER?.limit({ key: ip(request) });
  if (limit && !limit.success) {
    return error(429, 'Too many requests, try again in a minute');
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_WRITE_BYTES) {
    return error(413, 'Share is too large');
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_WRITE_BYTES) return error(413, 'Share is too large');
  const key = await signedRequestKey(request, path, body);
  return key ? { key, body } : error(401, 'Invalid request signature');
}

export function readJson<T>(body: ArrayBuffer): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as T;
  } catch {
    return null;
  }
}
