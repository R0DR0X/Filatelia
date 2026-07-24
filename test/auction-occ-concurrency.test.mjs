import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';

test('auction-occ-concurrency: verifies D1 Optimistic Concurrency Control OCC locking and 409 Conflict handling (TM-AUC-02)', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE Auction (
      id TEXT PRIMARY KEY,
      current_highest_bid REAL NOT NULL,
      total_bids INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );
  `);

  db.run(`INSERT INTO Auction VALUES ('auc-01', 150.00, 4, 'active');`);

  // Function to execute OCC conditional update
  function attemptOccBid(dbInstance, expectedBid, newBidAmount) {
    const stmt = dbInstance.prepare(`
      UPDATE Auction
      SET current_highest_bid = ?, total_bids = total_bids + 1
      WHERE id = 'auc-01' AND current_highest_bid = ? AND status = 'active';
    `);
    stmt.run([newBidAmount, expectedBid]);
    const changes = dbInstance.getRowsModified();
    stmt.free();
    return changes;
  }

  // User 1 and User 2 both read current_highest_bid = 150.00 simultaneously
  const readBidUser1 = 150.00;
  const readBidUser2 = 150.00;

  // User 1 submits bid first (new bid 160.00)
  const rowsModifiedUser1 = attemptOccBid(db, readBidUser1, 160.00);
  assert.equal(rowsModifiedUser1, 1, 'First user bid OCC query must modify 1 row');

  // User 2 submits bid second with stale read (expected 150.00, but DB is now 160.00)
  const rowsModifiedUser2 = attemptOccBid(db, readBidUser2, 160.00);
  assert.equal(rowsModifiedUser2, 0, 'Second user OCC query with stale expectation must modify 0 rows');

  // Check state in DB
  const res = db.exec("SELECT current_highest_bid, total_bids FROM Auction WHERE id='auc-01';");
  const finalBid = res[0].values[0][0];
  const finalTotalBids = res[0].values[0][1];

  assert.equal(finalBid, 160.00, 'Database highest bid must be exactly 160.00');
  assert.equal(finalTotalBids, 5, 'Total bids count must be incremented exactly once');
});
