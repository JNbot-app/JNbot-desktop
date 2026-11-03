-- Shares become private links or reviewed marketplace entries. The 0001
-- table held uncompressed v1 envelopes the app no longer reads, so it is
-- replaced rather than migrated.
DROP TABLE IF EXISTS shares;

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  -- 'link' (unlisted) or 'public' (marketplace after review)
  visibility TEXT NOT NULL,
  -- Review state of latest_revision: 'none' | 'pending' | 'live' | 'rejected'
  status TEXT NOT NULL,
  note TEXT,
  -- Revision downloads get: the approved one for public shares, latest for links.
  live_revision TEXT,
  latest_revision TEXT NOT NULL,
  reports INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX shares_owner ON shares (owner_key);
CREATE INDEX shares_visibility ON shares (visibility, status);

-- At most two rows per share: the live revision and one waiting for review.
CREATE TABLE share_revisions (
  share_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  listing TEXT NOT NULL,
  min_app_version TEXT NOT NULL,
  -- Gzipped signed envelope, at most 1 MB.
  content BLOB NOT NULL,
  content_sha256 TEXT NOT NULL,
  banner BLOB,
  banner_type TEXT,
  size INTEGER NOT NULL,
  -- Official key signature over approvalMessage(), set on approval.
  approval TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, revision)
);

CREATE TABLE reports (
  share_id TEXT NOT NULL,
  reporter_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, reporter_key)
);

-- 'market_version' changes whenever the listed set changes; it is the catalog ETag.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta (key, value) VALUES ('market_version', '1');
