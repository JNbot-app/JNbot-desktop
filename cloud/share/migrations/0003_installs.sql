-- Install counter, bumped by the app after each fresh install (not shown yet).
ALTER TABLE shares ADD COLUMN installs INTEGER NOT NULL DEFAULT 0;
