import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import initSqlJs from 'sql.js';

test('d1-idempotency: executes migrate-schema-v4.sql and verifies table structure', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Create base Stamp table
  db.run(`
    CREATE TABLE Stamp (
      id TEXT PRIMARY KEY,
      nameEs TEXT,
      nameEn TEXT,
      countryCode TEXT,
      year INTEGER,
      descriptionEs TEXT,
      rarityScore REAL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const rawMigrationSql = fs.readFileSync('./migrate-schema-v4.sql', 'utf-8');

  // Strip single line comments and SELECT status statement
  const cleanSql = rawMigrationSql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = cleanSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('SELECT'));

  for (const stmt of statements) {
    db.run(stmt);
  }

  // Verify stamp_market_prices table creation
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='stamp_market_prices'");
  assert.equal(res.length, 1);
  assert.equal(res[0].values[0][0], 'stamp_market_prices');

  // Verify columns added to Stamp table
  const colRes = db.exec("PRAGMA table_info(Stamp);");
  const colNames = colRes[0].values.map(c => c[1]);
  assert.ok(colNames.includes('description_es'));
  assert.ok(colNames.includes('rarity_score'));
  assert.ok(colNames.includes('market_price_usd'));
  assert.ok(colNames.includes('market_price_eur'));
});

test('d1-idempotency: verifies SQL upsert idempotency across 3 consecutive runs (RED-06)', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE stamp_market_prices (
      id TEXT PRIMARY KEY,
      stamp_id TEXT NOT NULL,
      source TEXT NOT NULL,
      listing_url TEXT,
      price_usd REAL,
      price_eur REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const upsertStmt = `
    INSERT INTO stamp_market_prices (id, stamp_id, source, listing_url, price_usd, price_eur)
    VALUES ('price-1', 'PE-1860-01', 'ebay', 'https://ebay.com/itm/123', 15.00, 13.80)
    ON CONFLICT(id) DO UPDATE SET
      price_usd = excluded.price_usd,
      price_eur = excluded.price_eur;
  `;

  // Run 3 times consecutively
  db.run(upsertStmt);
  db.run(upsertStmt);
  db.run(upsertStmt);

  const countRes = db.exec("SELECT COUNT(*) FROM stamp_market_prices");
  const totalRows = countRes[0].values[0][0];

  assert.equal(totalRows, 1, 'Consecutive upserts should maintain constant row count');

  const priceRes = db.exec("SELECT price_usd FROM stamp_market_prices WHERE id='price-1'");
  assert.equal(priceRes[0].values[0][0], 15.00);
});

test('d1-idempotency: verifies transaction rollback on write error (RED-03)', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run("CREATE TABLE test_table (id TEXT PRIMARY KEY, value TEXT NOT NULL);");

  let rollbackOccurred = false;
  try {
    db.run("BEGIN TRANSACTION;");
    db.run("INSERT INTO test_table VALUES ('1', 'valid');");
    // Violate NOT NULL constraint
    db.run("INSERT INTO test_table VALUES ('2', NULL);");
    db.run("COMMIT;");
  } catch (err) {
    db.run("ROLLBACK;");
    rollbackOccurred = true;
  }

  assert.equal(rollbackOccurred, true);
  const countRes = db.exec("SELECT COUNT(*) FROM test_table;");
  assert.equal(countRes[0].values[0][0], 0, 'Transaction failure must roll back all changes');
});
