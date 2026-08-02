-- D1 Migration v8: create the `SiteVisit` table used by the Worker's
-- `POST /analytics/visit` endpoint.
--
-- WHY: the Worker (workers/filatelia-api/src/index.ts) used to run
-- `CREATE TABLE IF NOT EXISTS SiteVisit ...` on every single request to
-- `/analytics/visit` — unauthenticated DDL against production D1 on the hot
-- path, since that endpoint is public by design (fired by
-- filatelia-web/src/components/AnalyticsTracker.tsx for every visitor).
-- The DDL has been removed from the handler; this migration is the
-- table's only creation path going forward.
--
-- IDEMPOTENT / SAFE ON A DATABASE WHERE THE TABLE ALREADY EXISTS: the
-- table has been created ad hoc by the old handler in production for as
-- long as the endpoint has been live, so `CREATE TABLE IF NOT EXISTS` is
-- required (not just conventional) here — a plain `CREATE TABLE` would
-- fail the very first time this migration runs against prod.
--
-- Column shape matches exactly what the handler already wrote, so no data
-- migration or column mapping is needed.
--
-- NOT EXECUTED BY THIS CHANGE. This file is committed as a reviewable,
-- idempotent artifact only. Running it against the real D1 database is a
-- separate, explicitly user-authorized step (same convention as 0007).

CREATE TABLE IF NOT EXISTS SiteVisit (
  id TEXT PRIMARY KEY,
  path TEXT,
  referrer TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);
