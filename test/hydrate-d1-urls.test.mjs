import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHydrateArgs, executeD1Batch } from '../scrapers/hydrate-d1-urls.mjs';

test('hydrate-d1-urls: parses CLI arguments correctly', () => {
  const args = parseHydrateArgs(['--batch-size=25', '--dry-run', '--verify-sample=50']);
  assert.equal(args.batchSize, 25);
  assert.equal(args.dryRun, true);
  assert.equal(args.verifySample, 50);
});

test('hydrate-d1-urls: handles batch rollback on database transaction failure', async () => {
  // Mock fetch endpoint returning 500 error simulating mid-batch SQL statement failure
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (url.includes('/batch')) {
      return {
        ok: false,
        status: 500,
        text: async () => 'D1_ERROR: SQL statement #25 failed due to invalid parameter constraints',
      };
    }
    return originalFetch(url, opts);
  };

  try {
    const statements = Array.from({ length: 50 }, (_, i) => ({
      sql: 'UPDATE Stamp SET imageUrl = ? WHERE id = ?',
      params: [`https://cdn.filatelia.app/stamps/${i}.jpg`, i],
    }));

    const result = await executeD1Batch(statements);

    assert.equal(result.success, false);
    assert.ok(result.error.includes('D1_ERROR'));
    assert.ok(result.error.includes('HTTP 500'));
  } finally {
    global.fetch = originalFetch;
  }
});
