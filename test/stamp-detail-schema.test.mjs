// Schema contract for the E3 stamp detail page (and the E2.6 import bug).
//
// These tests run the declared Worker schema plus the E3 migrations through a
// real SQLite engine, because every failure they guard against is a failure
// SQLite raises at *parse* time or at *constraint* time — not something a
// TypeScript type or a mocked D1 can catch.
//
// The Worker's own vitest suite cannot cover this: its pool binds Vectorize
// and Workers AI, which have no local simulator, so it needs a live
// CLOUDFLARE_API_TOKEN and a remote proxy session just to boot. A schema
// contract must be verifiable offline, so it lives here.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import initSqlJs from 'sql.js';

const SCHEMA = './workers/filatelia-api/schema.sql';
const MIGRATIONS = [
  './filatelia-web/db/migrations/0012_stamp_detail_fields.sql',
  './filatelia-web/db/migrations/0013_stamp_source_url_unique.sql',
];

/** Load the declared schema and apply the E3 migrations on top of it. */
async function freshDb({ migrate = true } = {}) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(fs.readFileSync(SCHEMA, 'utf-8'));
  if (migrate) {
    for (const path of MIGRATIONS) {
      db.exec(fs.readFileSync(path, 'utf-8'));
    }
  }
  return db;
}

/** Minimal parent rows: Stamp.groupId is NOT NULL and a FK to StampGroup. */
function seedGroup(db) {
  db.run(`INSERT INTO Catalog (id, name, status) VALUES ('cat-1', 'Test', 'activo')`);
  db.run(`INSERT INTO StampGroup (id, catalogId, titleEs) VALUES ('grp-1', 'cat-1', 'Grupo')`);
}

function columnsOf(db, table) {
  const [res] = db.exec(`PRAGMA table_info(${table})`);
  return new Set(res.values.map((row) => row[1]));
}

test('E3: the four Colnect parity fields exist on Stamp', async () => {
  const db = await freshDb();
  const cols = columnsOf(db, 'Stamp');

  for (const col of ['colnectCode', 'format', 'emission', 'gum']) {
    assert.ok(cols.has(col), `Stamp must expose \`${col}\` for the detail page`);
  }
  // sizeMm already existed in the declared schema and is NULL for all
  // 147,555 production rows; the detail scraper is what fills it.
  assert.ok(cols.has('sizeMm'), 'Stamp must keep sizeMm');
});

test('E3: StampVariant models variants and cascades from its parent stamp', async () => {
  const db = await freshDb();
  db.run('PRAGMA foreign_keys = ON');
  seedGroup(db);
  db.run(`INSERT INTO Stamp (id, nameEs, groupId) VALUES ('stamp-1', 'Mt Taranaki', 'grp-1')`);
  db.run(`
    INSERT INTO StampVariant (id, stampId, nameEn, colnectCode, sourceUrl)
    VALUES ('var-1', 'stamp-1', 'Imperforate', 'NZ-1234', 'https://colnect.test/v/1')
  `);

  const [before] = db.exec(`SELECT COUNT(*) FROM StampVariant`);
  assert.equal(before.values[0][0], 1);

  db.run(`DELETE FROM Stamp WHERE id = 'stamp-1'`);
  const [after] = db.exec(`SELECT COUNT(*) FROM StampVariant`);
  assert.equal(after.values[0][0], 0, 'variants must not outlive their stamp');
});

test('E3: a variant cannot be attached to a stamp that does not exist', async () => {
  const db = await freshDb();
  db.run('PRAGMA foreign_keys = ON');
  assert.throws(() => {
    db.run(`INSERT INTO StampVariant (id, stampId, nameEn) VALUES ('var-x', 'ghost', 'Nope')`);
  }, /FOREIGN KEY/i);
});

test('E3: the same variant URL cannot be scraped in twice', async () => {
  const db = await freshDb();
  seedGroup(db);
  db.run(`INSERT INTO Stamp (id, nameEs, groupId) VALUES ('stamp-1', 'A', 'grp-1')`);
  db.run(`
    INSERT INTO StampVariant (id, stampId, sourceUrl) VALUES ('var-1', 'stamp-1', 'https://colnect.test/v/1')
  `);
  assert.throws(() => {
    db.run(`
      INSERT INTO StampVariant (id, stampId, sourceUrl) VALUES ('var-2', 'stamp-1', 'https://colnect.test/v/1')
    `);
  }, /UNIQUE/i);
});

// ── E2.6 ────────────────────────────────────────────────────────────────────
// The non-WNS branch of importStampHandler upserts with ON CONFLICT(sourceUrl).
// SQLite requires the conflict target to be backed by a UNIQUE index, and the
// declared schema had none — so the statement failed to *parse* and every
// Colnect stamp in the batch was rejected. That is the "last batch persisted
// 0 of 3" symptom in PENDIENTES.md E2.6.
const IMPORT_UPSERT = `
  INSERT INTO Stamp (id, nameEs, groupId, sourceUrl, theme)
  VALUES (?, ?, 'grp-1', ?, ?)
  ON CONFLICT(sourceUrl) DO UPDATE SET
    theme     = COALESCE(excluded.theme, theme),
    updatedAt = datetime('now')
`;

test('E2.6 regression: the import upsert is rejected without a unique sourceUrl', async () => {
  const db = await freshDb({ migrate: false });
  seedGroup(db);
  assert.throws(
    () => db.run(IMPORT_UPSERT, ['s1', 'A', 'https://colnect.test/s/1', 'Fauna']),
    /ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint/,
    'this is the pre-migration failure the fix has to remove',
  );
});

test('E2.6 regression: with the unique index the import upsert inserts, then updates', async () => {
  const db = await freshDb();
  seedGroup(db);

  db.run(IMPORT_UPSERT, ['s1', 'A', 'https://colnect.test/s/1', 'Fauna']);
  db.run(IMPORT_UPSERT, ['s2', 'A', 'https://colnect.test/s/1', 'Flora']);

  const [rows] = db.exec(`SELECT id, theme FROM Stamp WHERE sourceUrl = 'https://colnect.test/s/1'`);
  assert.equal(rows.values.length, 1, 'the second import must update, not duplicate');
  assert.equal(rows.values[0][0], 's1', 'the original row id survives the upsert');
  assert.equal(rows.values[0][1], 'Flora', 'the re-scrape must overwrite the theme');
});

test('E2.6: stamps with no sourceUrl are still allowed to coexist', async () => {
  // SQLite treats NULLs as distinct in a UNIQUE index, and production holds
  // 1,940 excel-import and 66 wikidata rows that have no source URL at all.
  // A naive UNIQUE would have been fine; this test pins the behaviour so a
  // future "NOT NULL" tightening cannot silently lock those rows out.
  const db = await freshDb();
  seedGroup(db);
  db.run(`INSERT INTO Stamp (id, nameEs, groupId) VALUES ('a', 'A', 'grp-1')`);
  db.run(`INSERT INTO Stamp (id, nameEs, groupId) VALUES ('b', 'B', 'grp-1')`);

  const [rows] = db.exec(`SELECT COUNT(*) FROM Stamp WHERE sourceUrl IS NULL`);
  assert.equal(rows.values[0][0], 2);
});
