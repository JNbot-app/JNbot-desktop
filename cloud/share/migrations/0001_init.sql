CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  items TEXT NOT NULL,
  revision TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- The signed envelope (JSON). D1 caps a value at ~2 MB; shares are limited to 1 MB.
  body TEXT NOT NULL,
  -- Reserved for a future marketplace; share links are unlisted.
  listed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX shares_owner ON shares (owner_key);
