-- D1 Migration v9: add the `ignore` list_type and a `quantity` column to
-- UserCollection.
--
-- WHY: E4 (collector account) needs an "ignore" list alongside the existing
-- collection/wishlist/trade lists, plus a per-item `quantity` (how many
-- copies of a stamp the user holds/wants), defaulting to 1 so every existing
-- caller that never sends a quantity keeps working unchanged.
--
-- STRATEGY: SQLite cannot ALTER an existing CHECK constraint, so the two
-- options are (a) recreate the table under the standard SQLite
-- create-copy-drop-rename pattern, or (b) drop the DB-level CHECK entirely
-- and enforce the enum only in application code. This migration picks (a),
-- the table-recreate: UserCollection guards session-scoped user data behind
-- the same D1 binding that a past incident (see 0008's header and the
-- project history of a public SQL gateway/demo-user auth fallback) already
-- showed cannot be trusted to have every write path go through the
-- application layer. A DB-level CHECK is cheap defense-in-depth here and the
-- table-recreate needed to add it is a one-time, mechanical cost — not a
-- reason to give up the constraint. Application code (src/lib/db/collection.ts,
-- src/app/api/collection/route.ts) ALSO validates list_type, condition and
-- quantity independently; this migration keeps both layers in sync rather
-- than assuming either one alone is enough.
--
-- `quantity` is INTEGER NOT NULL DEFAULT 1 with a CHECK(quantity >= 1) at
-- the DB level (belt) and the API additionally rejects non-integer/zero/
-- negative quantities before they ever reach a query (suspenders) — see
-- addCollectionItem/updateCollectionItem and the POST/PUT handlers in
-- src/app/api/collection/route.ts.
--
-- SAFE ON A TABLE THAT ALREADY HAS ROWS: production is verified to have
-- ZERO rows in UserCollection today, but this migration does not rely on
-- that — it copies every existing row (id, user_id, stamp_id, list_type,
-- condition, notes, created_at, updated_at) into the recreated table rather
-- than assuming the table is empty. Every DDL statement is guarded
-- (IF EXISTS / IF NOT EXISTS) so re-running this file immediately after a
-- partial or repeated application errors on nothing. One honest caveat:
-- since the source table has no `quantity` column yet, every copied row is
-- seeded with quantity = 1; if this file were ever re-applied AFTER
-- quantity values had already diverged from 1 in production, those values
-- would be reset to 1. That is consistent with 0007/0008's "run once"
-- convention and is a non-issue today (zero rows), but is the reason this
-- migration is a single-shot artifact rather than one meant for routine
-- repeated execution once real quantity data exists.
--
-- NOT EXECUTED BY THIS CHANGE. This file is committed as a reviewable,
-- idempotent artifact only. Running it against the real D1 database is a
-- separate, explicitly user-authorized step outside this change (same
-- convention as 0007/0008 — this change must never write to the production
-- database).

DROP TABLE IF EXISTS UserCollection__new;

CREATE TABLE UserCollection__new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  stamp_id TEXT NOT NULL,
  list_type TEXT CHECK(list_type IN ('collection', 'wishlist', 'trade', 'ignore')) NOT NULL,
  condition TEXT CHECK(condition IN ('MNH', 'MH', 'Used', 'FDC')) NOT NULL DEFAULT 'MNH',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 1),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, stamp_id, list_type)
);

-- This migration runs after 0006 (which creates UserCollection with
-- CREATE TABLE IF NOT EXISTS), so the source table is guaranteed to exist
-- by the time this INSERT runs. Every existing row is carried forward with
-- quantity defaulted to 1, matching the column's own DEFAULT for any row
-- inserted going forward.
INSERT INTO UserCollection__new (id, user_id, stamp_id, list_type, condition, quantity, notes, created_at, updated_at)
SELECT id, user_id, stamp_id, list_type, condition, 1, notes, created_at, updated_at
FROM UserCollection;

DROP TABLE IF EXISTS UserCollection;

ALTER TABLE UserCollection__new RENAME TO UserCollection;

CREATE INDEX IF NOT EXISTS idx_user_collection_user_type ON UserCollection(user_id, list_type);
CREATE INDEX IF NOT EXISTS idx_user_collection_stamp ON UserCollection(stamp_id);
