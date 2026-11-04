import { approvalMessage, type ShareListing, type ShareReviewDecision } from '../../../../src/common/share';
import { isOfficialKey, sha256Hex, verifyEd25519 } from '../auth';
import { LATEST, allRecords, bumpMarket, isListed, pruneRevisions, type ShareRow } from '../db';
import { error, json, readJson, readSignedWrite, type SignedWrite } from '../http';

async function reviewer(request: Request, env: Env, path: string): Promise<SignedWrite | Response> {
  const write = await readSignedWrite(request, env, path);
  if (write instanceof Response) return write;
  return isOfficialKey(env, write.key) ? write : error(403, 'Only JNbot reviewers can do this');
}

/** Pending submissions plus reported live shares, newest first. */
export async function reviewQueue(request: Request, env: Env): Promise<Response> {
  const write = await reviewer(request, env, '/api/review');
  if (write instanceof Response) return write;
  const entries = await allRecords(
    env,
    LATEST,
    // A union, so each half reads only its partial index instead of every share.
    `s.id IN (SELECT id FROM shares WHERE visibility = 'public' AND status = 'pending'
              UNION SELECT id FROM shares WHERE reports > 0)
     ORDER BY s.updated_at DESC LIMIT 100`,
    `, (SELECT json_group_array(reason) FROM (SELECT reason FROM reports WHERE share_id = s.id LIMIT 10)) AS report_reasons`,
  );
  return json({ entries });
}

interface ReviewBody {
  revision?: unknown;
  decision?: ShareReviewDecision;
  note?: unknown;
  approval?: unknown;
}

/**
 * Approve: the request carries the official key's signature over the exact
 * revision, which the app verifies before listing or installing it.
 * Reject: the pending revision (or the live one, as a takedown) with a note.
 */
export async function reviewShare(request: Request, env: Env, row: ShareRow, path: string): Promise<Response> {
  const write = await reviewer(request, env, path);
  if (write instanceof Response) return write;
  const body = readJson<ReviewBody>(write.body);
  const revision = body?.revision;
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
  if (typeof revision !== 'string') return error(400, 'Invalid review');
  const now = Date.now();

  if (body?.decision === 'dismiss-reports') {
    await env.DB.batch([
      env.DB.prepare('UPDATE shares SET reports = 0 WHERE id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM reports WHERE share_id = ?').bind(row.id),
    ]);
    return json({ reviewed: true });
  }

  if (body?.decision === 'approve') {
    if (row.visibility !== 'public' || revision !== row.latest_revision) {
      return error(409, 'This revision is no longer waiting for review');
    }
    const target = await env.DB.prepare(
      'SELECT listing, content_sha256 FROM share_revisions WHERE share_id = ? AND revision = ?',
    )
      .bind(row.id, revision)
      .first<{ listing: string; content_sha256: string }>();
    const approval = typeof body.approval === 'string' ? body.approval : '';
    const message = target && approvalMessage(row.id, revision, await sha256Hex(target.listing), target.content_sha256);
    if (!message || !(await verifyEd25519(write.key, approval, message))) {
      return error(400, 'Invalid approval signature');
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE share_revisions SET approval = ? WHERE share_id = ? AND revision = ?').bind(
        approval,
        row.id,
        revision,
      ),
      // A new name is part of the review, so it only shows from here on.
      env.DB.prepare(
        `UPDATE shares SET owner_name = ?, status = 'live', note = NULL, live_revision = ?, reports = 0, updated_at = ? WHERE id = ?`,
      ).bind((JSON.parse(target!.listing) as ShareListing).publisherName, revision, now, row.id),
      pruneRevisions(env, row.id, [revision]),
      env.DB.prepare('DELETE FROM reports WHERE share_id = ?').bind(row.id),
      bumpMarket(env),
    ]);
    return json({ reviewed: true });
  }

  if (body?.decision === 'reject') {
    if (!note) return error(400, 'Tell the publisher why');
    // Rejecting the live revision takes the share off the marketplace.
    const takedown = revision === row.live_revision;
    if (!takedown && revision !== row.latest_revision) return error(409, 'This revision is no longer waiting for review');
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE shares SET status = 'rejected', note = ?, live_revision = ?, reports = 0, updated_at = ? WHERE id = ?`,
      ).bind(note, takedown ? null : row.live_revision, now, row.id),
      env.DB.prepare('DELETE FROM reports WHERE share_id = ?').bind(row.id),
      // Apps trust the approval, not the status: without this it still shows as reviewed.
      ...(takedown
        ? [env.DB.prepare('UPDATE share_revisions SET approval = NULL WHERE share_id = ? AND revision = ?').bind(row.id, revision)]
        : []),
      ...(takedown && isListed(row) ? [bumpMarket(env)] : []),
    ]);
    return json({ reviewed: true });
  }
  return error(400, 'Invalid review');
}
