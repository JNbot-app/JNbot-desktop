-- D1 bills scanned index entries as rows read, so match the hot queries exactly.

-- Covers the per-owner share and pending counts.
DROP INDEX shares_owner;
CREATE INDEX shares_owner ON shares (owner_key, visibility, status);

-- The marketplace catalog: only listed shares.
DROP INDEX shares_visibility;
CREATE INDEX shares_listed ON shares (id) WHERE visibility = 'public' AND live_revision IS NOT NULL;

-- The review queue: pending submissions and reported shares.
CREATE INDEX shares_pending ON shares (id) WHERE visibility = 'public' AND status = 'pending';
CREATE INDEX shares_reported ON shares (id) WHERE reports > 0;
