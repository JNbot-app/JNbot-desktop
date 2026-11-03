import {
  MAX_REVISION_LOOKUP,
  SHARE_ID_PATTERN,
  type ShareRevisionStatus,
} from '../../../../src/common/share';
import { LIVE, allRecords, getRecord } from '../db';
import { API_HEADERS, error, json } from '../http';

/** Revisions never change, so their content and banner cache forever. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

export async function getShare(env: Env, id: string): Promise<Response> {
  const record = await getRecord(env, id);
  return record ? json(record) : error(404, 'Share not found');
}

export async function getContent(env: Env, id: string, revision: string): Promise<Response> {
  const content = await env.DB.prepare('SELECT content FROM share_revisions WHERE share_id = ? AND revision = ?')
    .bind(id, revision)
    .first<number[]>('content');
  if (!content) return error(404, 'Share not found');
  // D1 returns BLOBs as number arrays.
  return new Response(new Uint8Array(content), {
    headers: { ...API_HEADERS, 'content-type': 'application/gzip', 'cache-control': IMMUTABLE },
  });
}

export async function getBanner(env: Env, id: string, revision: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT banner, banner_type FROM share_revisions WHERE share_id = ? AND revision = ? AND banner IS NOT NULL',
  )
    .bind(id, revision)
    .first<{ banner: number[]; banner_type: string }>();
  if (!row) return error(404, 'Banner not found');
  return new Response(new Uint8Array(row.banner), {
    headers: {
      ...API_HEADERS,
      // Sniffed on upload; never SVG, so it cannot run script.
      'content-type': row.banner_type,
      'content-security-policy': "default-src 'none'",
      'cache-control': IMMUTABLE,
    },
  });
}

/** Unsigned and only per-IP rate limited: a rough popularity count, not an exact one. */
export async function countInstall(env: Env, id: string): Promise<Response> {
  const { meta } = await env.DB.prepare('UPDATE shares SET installs = installs + 1 WHERE id = ?').bind(id).run();
  return meta.changes ? new Response(null, { status: 204, headers: API_HEADERS }) : error(404, 'Share not found');
}

/** Every listed share in one response; `If-None-Match` makes repeat checks one row read. */
export async function getMarket(request: Request, env: Env): Promise<Response> {
  const version = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'market_version'`).first<string>('value');
  const etag = `"m${version}"`;
  const headers = { etag, 'cache-control': 'no-cache', 'access-control-expose-headers': 'etag' };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ...API_HEADERS, ...headers } });
  }
  const entries = await allRecords(env, LIVE, `s.visibility = 'public' AND s.live_revision IS NOT NULL`);
  return json({ entries }, 200, headers);
}

/** Current status per id (null when deleted), for batched update and status checks. */
export async function getRevisions(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && SHARE_ID_PATTERN.test(id)))]
    : [];
  if (!ids.length || ids.length > MAX_REVISION_LOOKUP) return error(400, 'Invalid ids');
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.visibility, s.status, s.note, s.live_revision, s.latest_revision, r.revision, r.min_app_version
     FROM shares s JOIN share_revisions r ON r.share_id = s.id AND r.revision = COALESCE(s.live_revision, s.latest_revision)
     WHERE s.id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(ids))
    .all<{
      id: string;
      visibility: ShareRevisionStatus['visibility'];
      status: ShareRevisionStatus['status'];
      note: string | null;
      live_revision: string | null;
      latest_revision: string;
      revision: string;
      min_app_version: string;
    }>();
  const found = new Map(
    results.map((row): [string, ShareRevisionStatus] => [
      row.id,
      {
        revision: row.revision,
        minAppVersion: row.min_app_version,
        status: row.status,
        visibility: row.visibility,
        note: row.note,
        pending: row.latest_revision !== row.revision,
        listed: row.visibility === 'public' && !!row.live_revision,
      },
    ]),
  );
  return json(Object.fromEntries(ids.map((id) => [id, found.get(id) ?? null])));
}
