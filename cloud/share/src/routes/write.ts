import {
  MAX_BANNER_BYTES,
  MAX_LINK_SHARES_PER_OWNER,
  MAX_PENDING_PER_OWNER,
  MAX_SHARE_BYTES,
  MAX_SHARES_PER_OWNER,
  shareUrl,
  sniffImageType,
  type ShareListing,
  type ShareVisibility,
} from '../../../../src/common/share';
import { isOfficialKey, sha256Hex } from '../auth';
import {
  bumpMarket,
  isListed,
  linkCount,
  pendingCount,
  pruneRevisions,
  totalCount,
  type ShareRow,
} from '../db';
import { error, json, readJson, readSignedWrite } from '../http';
import { parseListing } from '../listing';

const ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function newShareId(): string {
  // 62 * 4 = 248 keeps the modulo unbiased.
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes]
    .filter((byte) => byte < 248)
    .slice(0, 10)
    .map((byte) => ID_ALPHABET[byte % 62])
    .join('');
}

const isVisibility = (value: unknown): value is ShareVisibility =>
  value === 'link' || value === 'public';

interface Upload {
  key: string;
  listing: ShareListing;
  listingText: string;
  content: Uint8Array<ArrayBuffer>;
  contentSha256: string;
  banner: Uint8Array<ArrayBuffer> | null;
  bannerType: string | null;
  revision: string;
  visibility: ShareVisibility;
}

/** Signed multipart upload: `listing`, `content` (gzip), optional `banner`, `visibility`. */
async function readUpload(request: Request, env: Env, path: string): Promise<Upload | Response> {
  const write = await readSignedWrite(request, env, path);
  if (write instanceof Response) return write;
  let form: FormData;
  try {
    form = await new Response(write.body, {
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
    }).formData();
  } catch {
    return error(400, 'Invalid share');
  }
  const listingText = form.get('listing');
  const contentFile = form.get('content');
  const bannerFile = form.get('banner');
  const visibility = form.get('visibility');
  if (typeof listingText !== 'string' || !(contentFile instanceof File) || !isVisibility(visibility)) {
    return error(400, 'Invalid share');
  }
  const listing = parseListing(listingText);
  if (!listing) return error(400, 'Invalid share');
  const content = new Uint8Array(await contentFile.arrayBuffer());
  if (content.byteLength > MAX_SHARE_BYTES) return error(413, 'Share is too large (max 1 MB compressed)');
  if (content[0] !== 0x1f || content[1] !== 0x8b) return error(400, 'Share content must be gzipped');
  let banner: Uint8Array<ArrayBuffer> | null = null;
  let bannerType: string | null = null;
  if (bannerFile instanceof File) {
    banner = new Uint8Array(await bannerFile.arrayBuffer());
    bannerType = sniffImageType(banner);
    if (banner.byteLength > MAX_BANNER_BYTES) return error(413, 'Banner is too large (max 256 KB)');
    if (!bannerType) return error(400, 'Banner must be a PNG, JPEG, WebP or GIF image');
  }
  const contentSha256 = await sha256Hex(content);
  const bannerSha256 = banner ? await sha256Hex(banner) : '';
  const revision = (await sha256Hex(`${listingText}\n${contentSha256}\n${bannerSha256}`)).slice(0, 16);
  return {
    key: write.key,
    listing,
    listingText,
    content,
    contentSha256,
    banner,
    bannerType,
    revision,
    visibility,
  };
}

function insertRevision(env: Env, id: string, upload: Upload, now: number) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO share_revisions
       (share_id, revision, listing, min_app_version, content, content_sha256, banner, banner_type, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    upload.revision,
    upload.listingText,
    upload.listing.minAppVersion,
    upload.content,
    upload.contentSha256,
    upload.banner,
    upload.bannerType,
    upload.content.byteLength + (upload.banner?.byteLength ?? 0),
    now,
  );
}

const result = (request: Request, id: string, revision: string, status = 201) =>
  json({ id, revision, url: shareUrl(id, new URL(request.url).origin) }, status);

const tooManyPending = () =>
  error(409, `You can have at most ${MAX_PENDING_PER_OWNER} shares waiting for review`);

const tooManyLinks = () =>
  error(409, `You can have at most ${MAX_LINK_SHARES_PER_OWNER} private shares, delete one first`);

export async function createShare(request: Request, env: Env): Promise<Response> {
  const upload = await readUpload(request, env, '/api/s');
  if (upload instanceof Response) return upload;
  if ((await totalCount(env, upload.key)) >= MAX_SHARES_PER_OWNER) {
    return error(409, `You can have at most ${MAX_SHARES_PER_OWNER} shares`);
  }
  const isPublic = upload.visibility === 'public';
  if (isPublic && (await pendingCount(env, upload.key)) >= MAX_PENDING_PER_OWNER) return tooManyPending();
  if (!isPublic && (await linkCount(env, upload.key)) >= MAX_LINK_SHARES_PER_OWNER) return tooManyLinks();
  const id = newShareId();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO shares (id, owner_key, owner_name, kind, visibility, status, live_revision, latest_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      upload.key,
      upload.listing.publisherName,
      upload.listing.kind,
      upload.visibility,
      isPublic ? 'pending' : 'none',
      isPublic ? null : upload.revision,
      upload.revision,
      now,
      now,
    ),
    insertRevision(env, id, upload, now),
  ]);
  return result(request, id, upload.revision);
}

/**
 * Links switch to the new revision at once. Public shares keep serving the
 * approved revision until the new one is reviewed.
 */
export async function updateShare(request: Request, env: Env, row: ShareRow, path: string): Promise<Response> {
  const upload = await readUpload(request, env, path);
  if (upload instanceof Response) return upload;
  if (upload.key !== row.owner_key) return error(403, 'Not the owner of this share');
  if (upload.listing.kind !== row.kind) return error(409, 'Share kind cannot change');
  if (upload.revision === row.latest_revision && upload.visibility === row.visibility) {
    return result(request, row.id, row.latest_revision, 200);
  }
  const isPublic = upload.visibility === 'public';
  if (isPublic && row.status !== 'pending' && (await pendingCount(env, upload.key)) >= MAX_PENDING_PER_OWNER) {
    return tooManyPending();
  }
  if (!isPublic && row.visibility === 'public' && (await linkCount(env, upload.key)) >= MAX_LINK_SHARES_PER_OWNER) {
    return tooManyLinks();
  }
  const now = Date.now();
  // A link that becomes public was never reviewed, so nothing stays live.
  const live = isPublic ? (row.visibility === 'public' ? row.live_revision : null) : upload.revision;
  // The listed name stays the reviewed one until this revision is approved.
  const ownerName = isPublic && live ? row.owner_name : upload.listing.publisherName;
  await env.DB.batch([
    insertRevision(env, row.id, upload, now),
    env.DB.prepare(
      `UPDATE shares SET owner_name = ?, visibility = ?, status = ?, note = NULL, live_revision = ?, latest_revision = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(ownerName, upload.visibility, isPublic ? 'pending' : 'none', live, upload.revision, now, row.id),
    pruneRevisions(env, row.id, [live, upload.revision]),
    ...(isListed(row) && !isPublic ? [bumpMarket(env)] : []),
  ]);
  return result(request, row.id, upload.revision, 200);
}

/** Withdraw from the marketplace (back to a link) without uploading again. */
export async function unlistShare(request: Request, env: Env, row: ShareRow, path: string): Promise<Response> {
  const write = await readSignedWrite(request, env, path);
  if (write instanceof Response) return write;
  if (write.key !== row.owner_key) return error(403, 'Not the owner of this share');
  if (row.visibility === 'link') return result(request, row.id, row.latest_revision, 200);
  if ((await linkCount(env, write.key)) >= MAX_LINK_SHARES_PER_OWNER) return tooManyLinks();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE shares SET visibility = 'link', status = 'none', note = NULL, reports = 0, live_revision = latest_revision, updated_at = ?
       WHERE id = ?`,
    ).bind(Date.now(), row.id),
    pruneRevisions(env, row.id, [row.latest_revision]),
    env.DB.prepare('DELETE FROM reports WHERE share_id = ?').bind(row.id),
    ...(isListed(row) ? [bumpMarket(env)] : []),
  ]);
  return result(request, row.id, row.latest_revision, 200);
}

/** Owner or an official key. */
export async function deleteShare(request: Request, env: Env, row: ShareRow, path: string): Promise<Response> {
  const write = await readSignedWrite(request, env, path);
  if (write instanceof Response) return write;
  if (write.key !== row.owner_key && !isOfficialKey(env, write.key)) {
    return error(403, 'Not the owner of this share');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM share_revisions WHERE share_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM reports WHERE share_id = ?').bind(row.id),
    ...(isListed(row) ? [bumpMarket(env)] : []),
  ]);
  return json({ deleted: true });
}

/** One report per key per share; only listed shares can be reported. */
export async function reportShare(request: Request, env: Env, row: ShareRow, path: string): Promise<Response> {
  const write = await readSignedWrite(request, env, path);
  if (write instanceof Response) return write;
  const reason = readJson<{ reason?: unknown }>(write.body)?.reason;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 300) {
    return error(400, 'Give a short reason (max 300 characters)');
  }
  if (!isListed(row)) return error(404, 'Share not found');
  const inserted = await env.DB.prepare(
    'INSERT OR IGNORE INTO reports (share_id, reporter_key, reason, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(row.id, write.key, reason.trim(), Date.now())
    .run();
  if (inserted.meta.changes) {
    await env.DB.prepare('UPDATE shares SET reports = reports + 1 WHERE id = ?').bind(row.id).run();
  }
  return json({ reported: true });
}
