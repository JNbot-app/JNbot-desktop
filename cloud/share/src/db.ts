import type { ShareKind, ShareRecord, ShareStatus, ShareVisibility } from '../../../src/common/share';

export interface ShareRow {
  id: string;
  owner_key: string;
  owner_name: string;
  kind: ShareKind;
  visibility: ShareVisibility;
  status: ShareStatus;
  note: string | null;
  live_revision: string | null;
  latest_revision: string;
  reports: number;
  installs: number;
  created_at: number;
  updated_at: number;
}

interface RecordRow extends ShareRow {
  revision: string;
  listing: string;
  min_app_version: string;
  content_sha256: string;
  approval: string | null;
  has_banner: number;
  size: number;
  report_reasons?: string | null;
}

/** Which revision a record query joins: what downloads get, the latest, or the listed one. */
export const SERVED = 'COALESCE(s.live_revision, s.latest_revision)';
export const LATEST = 's.latest_revision';
export const LIVE = 's.live_revision';

export const recordQuery = (revision: string, where: string, extra = '') =>
  `SELECT s.*, r.revision, r.listing, r.min_app_version, r.content_sha256, r.approval,
          r.banner_type IS NOT NULL AS has_banner, r.size${extra}
   FROM shares s JOIN share_revisions r ON r.share_id = s.id AND r.revision = ${revision}
   WHERE ${where}`;

export function toRecord(row: RecordRow): ShareRecord {
  return {
    id: row.id,
    kind: row.kind,
    ownerKey: row.owner_key,
    ownerName: row.owner_name,
    visibility: row.visibility,
    status: row.status,
    note: row.note,
    revision: row.revision,
    listing: row.listing,
    contentSha256: row.content_sha256,
    approval: row.approval,
    hasBanner: !!row.has_banner,
    size: row.size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.report_reasons !== undefined
      ? { reports: row.reports, reportReasons: row.report_reasons ? (JSON.parse(row.report_reasons) as string[]) : [] }
      : {}),
  };
}

export async function getRecord(env: Env, id: string, revision = SERVED): Promise<ShareRecord | null> {
  const row = await env.DB.prepare(recordQuery(revision, 's.id = ?')).bind(id).first<RecordRow>();
  return row ? toRecord(row) : null;
}

export async function allRecords(env: Env, revision: string, where: string, extra = ''): Promise<ShareRecord[]> {
  const { results } = await env.DB.prepare(recordQuery(revision, where, extra)).all<RecordRow>();
  return results.map(toRecord);
}

export const getRow = (env: Env, id: string) =>
  env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(id).first<ShareRow>();

export const isListed = (row: Pick<ShareRow, 'visibility' | 'live_revision'>) =>
  row.visibility === 'public' && !!row.live_revision;

/** Bumps the catalog ETag; call whenever the listed set changes. */
export const bumpMarket = (env: Env) =>
  env.DB.prepare(
    `UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'market_version'`,
  );

/** Drops every revision of a share except `keep`. */
export const pruneRevisions = (env: Env, id: string, keep: Array<string | null>) => {
  const kept = keep.filter((revision): revision is string => !!revision);
  return env.DB.prepare(
    `DELETE FROM share_revisions WHERE share_id = ? AND revision NOT IN (SELECT value FROM json_each(?))`,
  ).bind(id, JSON.stringify(kept));
};

const ownedCount = async (env: Env, key: string, filter = '') =>
  (await env.DB.prepare(`SELECT COUNT(*) AS count FROM shares WHERE owner_key = ? ${filter}`)
    .bind(key)
    .first<number>('count')) ?? 0;

export const totalCount = (env: Env, key: string) => ownedCount(env, key);
export const linkCount = (env: Env, key: string) => ownedCount(env, key, `AND visibility = 'link'`);
export const pendingCount = (env: Env, key: string) =>
  ownedCount(env, key, `AND visibility = 'public' AND status = 'pending'`);
