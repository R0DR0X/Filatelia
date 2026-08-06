-- D1 Migration v12: the remaining Colnect parity fields on Stamp, plus the
-- StampVariant table.
--
-- WHY: E3 (ficha con paridad Colnect) needs four fields the schema never had —
-- `colnectCode`, `format`, `emission`, `gum` — and a place to store the
-- variants Colnect exposes behind "Click to see variants". `sizeMm` already
-- existed and is deliberately NOT re-added here.
--
-- ORDER OF OPERATIONS. This migration only widens the schema; it adds nullable
-- columns and one new table, so it is safe to apply BEFORE deploying any code.
-- Every reader (`SELECT s.*`) and every writer keeps working unchanged while
-- the new columns sit NULL. That is the opposite of 0009, which had to land
-- before its deploy or break live writes.
--
-- THE DATA IS NOT HERE YET, AND THAT IS FINE. The detail phase of the Colnect
-- scraper has never run (E2 is blocked on proxy bandwidth), so on the day this
-- lands all 147,555 production rows have NULL in all four columns and
-- StampVariant is empty. The detail page is written to degrade field by field:
-- a NULL renders nothing rather than an empty label. Shipping the schema and
-- the UI now means the moment the scraper runs, the fichas fill in with no
-- further deploy.
--
-- `format` and `emission` are not SQLite reserved words, but they read like
-- them; they are quoted at every use site for the benefit of the next person
-- to read a query, not because SQLite requires it.
--
-- NOT EXECUTED BY THIS CHANGE. Committed as a reviewable artifact only.
-- Applying it to the real D1 database is a separate, explicitly authorized
-- step (same convention as 0007-0011). See scripts/ops/e3-rollout.sh.

ALTER TABLE Stamp ADD COLUMN colnectCode TEXT;
ALTER TABLE Stamp ADD COLUMN "format" TEXT;
ALTER TABLE Stamp ADD COLUMN "emission" TEXT;
ALTER TABLE Stamp ADD COLUMN gum TEXT;

-- Looking a stamp up by its Colnect code is how a re-scrape reconciles against
-- what is already stored. Not UNIQUE: the code is scraped text from a third
-- party, and a duplicate must never be able to abort an import batch.
CREATE INDEX IF NOT EXISTS idx_stamp_colnect_code ON Stamp(colnectCode);

-- Variants are a child collection, not a self-reference on Stamp. A variant is
-- not itself a catalogued stamp: it has no group, no country, no market price,
-- and it must never surface as its own row in /stamps or in search results. A
-- self-referencing parentId column would have put every variant into exactly
-- those listings and forced `WHERE parentId IS NULL` onto every existing query
-- in the Worker — a filter that is silently missing until someone notices the
-- catalogue count is wrong.
CREATE TABLE IF NOT EXISTS StampVariant (
  id TEXT PRIMARY KEY,
  stampId TEXT NOT NULL REFERENCES Stamp(id) ON DELETE CASCADE,

  colnectCode TEXT,
  nameEs TEXT,
  nameEn TEXT,
  description TEXT,

  denomination REAL,
  currency TEXT,
  color TEXT,
  perforation TEXT,
  gum TEXT,
  "format" TEXT,

  imageUrl TEXT,
  sourceUrl TEXT,
  "order" INTEGER DEFAULT 0,

  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stamp_variant_stamp ON StampVariant(stampId);

-- The scraper is re-runnable and will re-visit the same variant URL on every
-- pass. This index is what makes that idempotent instead of duplicating a
-- variant per run: the importer upserts with ON CONFLICT(sourceUrl).
--
-- Full index, not partial, for the same reason as 0013: SQLite only accepts a
-- partial index as an ON CONFLICT target when the conflict clause repeats the
-- predicate. Variants parsed out of an inline table carry no URL of their own,
-- and NULLs stay distinct in a UNIQUE index, so those still coexist freely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_variant_source_url
  ON StampVariant(sourceUrl);
