import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

// `POST /import-stamp` used to be completely unauthenticated: anyone on the
// internet could bulk-insert/update rows in the production `Stamp` table.
// It must now be guarded by `requireAdmin`, exactly like the `/admin/*`
// routes, so an automated caller (the scrapers) authenticates via
// `X-Admin-Token` and everyone else is rejected with 403.
//
// `/admin/import-stamp` and `/admin/analytics/stats` are the same handlers,
// additionally reachable through the Next admin proxy (which only forwards
// to Worker `/admin/<path>`).
//
// NOTE: this suite's pool has no D1 migrations, so a request that clears
// authorization still hits `no such table: Stamp`/`SiteVisit` and answers
// 500. The assertions below therefore only prove the authorization outcome
// (403 vs "not 403"), never the D1-dependent success body.

const VALID_TOKEN = 'test-admin-service-token-0123456789';

describe('POST /import-stamp authorization (regression for the unauthenticated bulk-write hole)', () => {
  it('rejects with 403 a request with no credentials at all', async () => {
    const res = await SELF.fetch('http://worker/import-stamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stamps: [] }),
    });

    expect(res.status).toBe(403);
  });

  it('does not reject with 403 a request bearing the correct X-Admin-Token', async () => {
    const res = await SELF.fetch('http://worker/import-stamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ stamps: [] }),
    });

    expect(res.status).not.toBe(403);
  });
});

describe('POST /admin/import-stamp (proxy-reachable alias)', () => {
  it('rejects with 403 a request with no credentials at all', async () => {
    const res = await SELF.fetch('http://worker/admin/import-stamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stamps: [] }),
    });

    expect(res.status).toBe(403);
  });

  it('does not reject with 403 a request bearing the correct X-Admin-Token', async () => {
    const res = await SELF.fetch('http://worker/admin/import-stamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ stamps: [] }),
    });

    expect(res.status).not.toBe(403);
  });
});

describe('GET /admin/analytics/stats (proxy-reachable alias)', () => {
  it('rejects with 403 a request with no credentials at all', async () => {
    const res = await SELF.fetch('http://worker/admin/analytics/stats');

    expect(res.status).toBe(403);
  });

  it('does not reject with 403 a request bearing the correct X-Admin-Token', async () => {
    const res = await SELF.fetch('http://worker/admin/analytics/stats', {
      headers: { 'X-Admin-Token': VALID_TOKEN },
    });

    expect(res.status).not.toBe(403);
  });
});
