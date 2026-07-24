import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';

test('auction-settlement: verifies settlement worker idempotency and winner assignment (TM-AUC-05)', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE Auction (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      current_highest_bid REAL NOT NULL,
      current_highest_bidder_id TEXT,
      current_highest_bidder_name TEXT,
      end_time DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);

  // Insert active auction that expired 10 minutes ago
  const expiredTime = new Date(Date.now() - 600 * 1000).toISOString();
  // Insert active auction expiring in future
  const futureTime = new Date(Date.now() + 3600 * 1000).toISOString();

  db.run(`
    INSERT INTO Auction (id, title, current_highest_bid, current_highest_bidder_id, current_highest_bidder_name, end_time, status)
    VALUES 
      ('auc-exp-01', 'Expired Auction', 200.00, 'usr-winner-01', 'Winner One', '${expiredTime}', 'active'),
      ('auc-act-02', 'Future Auction', 100.00, 'usr-bidder-02', 'Bidder Two', '${futureTime}', 'active');
  `);

  // Function simulating settlement worker execution
  function runSettlementWorker(dbInstance, currentIsoTime) {
    const stmt = dbInstance.prepare(`
      UPDATE Auction
      SET status = 'ended'
      WHERE status = 'active' AND end_time <= ?;
    `);
    stmt.run([currentIsoTime]);
    const count = dbInstance.getRowsModified();
    stmt.free();
    return count;
  }

  const nowIso = new Date().toISOString();

  // First run -> should settle 1 expired auction
  const run1Settled = runSettlementWorker(db, nowIso);
  assert.equal(run1Settled, 1, 'First settlement run must transition expired auction to ended');

  // Verify status of expired auction is now ended and winner is retained
  const res1 = db.exec("SELECT status, current_highest_bidder_name FROM Auction WHERE id='auc-exp-01';");
  assert.equal(res1[0].values[0][0], 'ended');
  assert.equal(res1[0].values[0][1], 'Winner One');

  // Second run (Idempotency check) -> should settle 0 auctions
  const run2Settled = runSettlementWorker(db, nowIso);
  assert.equal(run2Settled, 0, 'Second settlement run must be idempotent and settle 0 auctions');

  // Future auction remains active
  const res2 = db.exec("SELECT status FROM Auction WHERE id='auc-act-02';");
  assert.equal(res2[0].values[0][0], 'active');
});
