import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import initSqlJs from 'sql.js';

test('auction-d1-constraints: verifies D1 schema CHECK constraints reject invalid auction/bid status (TM-AUC-04)', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  const migrationSql = fs.readFileSync('./migrate-schema-v5.sql', 'utf-8');
  
  // Filter comments and execute schema DDL
  const cleanSql = migrationSql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  db.exec(cleanSql);

  // Insert valid auction
  db.run(`
    INSERT INTO Auction (id, stamp_id, title, starting_price, min_increment, current_highest_bid, end_time, status)
    VALUES ('auc-test-01', 'PE-1857-01', 'Perú 1857 1d', 100.0, 5.0, 100.0, '2026-12-31 23:59:59', 'active');
  `);

  // Attempt to insert invalid auction status string -> Should fail CHECK constraint
  let auctionCheckFailed = false;
  try {
    db.run(`
      INSERT INTO Auction (id, stamp_id, title, starting_price, min_increment, current_highest_bid, end_time, status)
      VALUES ('auc-test-02', 'PE-1857-02', 'Invalid Status Test', 100.0, 5.0, 100.0, '2026-12-31 23:59:59', 'hack_status');
    `);
  } catch (err) {
    auctionCheckFailed = true;
  }
  assert.equal(auctionCheckFailed, true, 'CHECK constraint must reject invalid auction status');

  // Insert valid bid
  db.run(`
    INSERT INTO Bid (id, auction_id, bidder_id, bidder_name, amount, status)
    VALUES ('bid-test-01', 'auc-test-01', 'usr-01', 'User 1', 110.0, 'accepted');
  `);

  // Attempt to insert invalid bid status -> Should fail CHECK constraint
  let bidCheckFailed = false;
  try {
    db.run(`
      INSERT INTO Bid (id, auction_id, bidder_id, bidder_name, amount, status)
      VALUES ('bid-test-02', 'auc-test-01', 'usr-02', 'User 2', 120.0, 'invalid_status');
    `);
  } catch (err) {
    bidCheckFailed = true;
  }
  assert.equal(bidCheckFailed, true, 'CHECK constraint must reject invalid bid status');
});
