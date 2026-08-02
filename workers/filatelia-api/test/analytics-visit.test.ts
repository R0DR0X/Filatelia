import { describe, it, expect, vi, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { truncateAnalyticsField, ANALYTICS_FIELD_MAX_LENGTH } from '../src/index';

// `POST /analytics/visit` is PUBLIC BY DESIGN — it is fired by
// `AnalyticsTracker.tsx` for every anonymous visitor and must stay
// unauthenticated. Its real problems were:
//   (a) it ran `CREATE TABLE IF NOT EXISTS SiteVisit` on every single
//       request — unauthenticated DDL against production D1 on the hot
//       path. That DDL is now gone; the table is created by a migration.
//   (b) it inserted caller-supplied `path`/`referrer` with no length
//       bound, letting an anonymous caller write unbounded strings into
//       prod D1. Both fields are now truncated (never rejected) to
//       `ANALYTICS_FIELD_MAX_LENGTH`.
//
// NOTE: this suite's pool has no D1 migrations, so any request that reaches
// the `SiteVisit` INSERT still answers 500 (`no such table: SiteVisit`).
// That is expected and is NOT what these tests assert. The DDL-removal and
// truncation behavior are proven directly against the extracted
// `truncateAnalyticsField` function and by spying on `D1Database.prepare`
// to assert no `CREATE TABLE` statement is ever issued.

describe('truncateAnalyticsField (unit)', () => {
  it('leaves short values untouched', () => {
    expect(truncateAnalyticsField('/stamps/peru')).toBe('/stamps/peru');
  });

  it('truncates a value longer than the bound to exactly the bound', () => {
    const long = 'a'.repeat(ANALYTICS_FIELD_MAX_LENGTH + 500);
    const result = truncateAnalyticsField(long);
    expect(result.length).toBe(ANALYTICS_FIELD_MAX_LENGTH);
  });

  it('never throws or rejects — truncates instead, so telemetry is never lost', () => {
    const long = 'x'.repeat(100000);
    expect(() => truncateAnalyticsField(long)).not.toThrow();
  });

  it('passes through null/undefined unchanged', () => {
    expect(truncateAnalyticsField(null)).toBeNull();
    expect(truncateAnalyticsField(undefined)).toBeUndefined();
  });
});

describe('POST /analytics/visit stays unauthenticated', () => {
  it('does not reject an anonymous request with 403 (this endpoint has no auth by design)', async () => {
    const res = await SELF.fetch('http://worker/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/stamps/peru', referrer: 'https://google.com' }),
    });

    expect(res.status).not.toBe(403);
  });
});

describe('POST /analytics/visit no longer issues DDL', () => {
  it('never prepares a CREATE TABLE statement, even on the very first call', async () => {
    const db = (await import('cloudflare:test')).env.DB as D1Database;
    const originalPrepare = db.prepare.bind(db);
    const preparedStatements: string[] = [];
    const spyPrepare = (sql: string) => {
      preparedStatements.push(sql);
      return originalPrepare(sql);
    };
    (db as any).prepare = spyPrepare;

    try {
      await SELF.fetch('http://worker/analytics/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/stamps/peru', referrer: null }),
      });
    } catch {
      // The suite has no D1 migrations, so the INSERT itself may throw
      // ("no such table: SiteVisit"). That is expected and irrelevant here.
    }

    (db as any).prepare = originalPrepare;

    const ddlStatements = preparedStatements.filter((sql) => /CREATE TABLE/i.test(sql));
    expect(ddlStatements).toEqual([]);
  });
});

// `ANALYTICS_FIELD_MAX_LENGTH` is a UTF-8 BYTE bound, because that is what
// actually bounds the D1 row. `String.prototype.slice` counts UTF-16 code
// units, so it neither bounds bytes (3-byte CJK/Cyrillic text slices to 512
// code units = ~1536 bytes) nor guarantees a valid string (a cut between a
// surrogate pair leaves a lone surrogate, which SQLite may store as U+FFFD or
// as malformed bytes).
describe('truncateAnalyticsField bounds UTF-8 BYTES, not UTF-16 code units', () => {
  const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;

  it('bounds a long CJK string to the byte limit, not the code-unit limit', () => {
    const cjk = '漢'.repeat(ANALYTICS_FIELD_MAX_LENGTH);
    const result = truncateAnalyticsField(cjk) as string;
    expect(utf8Bytes(result)).toBeLessThanOrEqual(ANALYTICS_FIELD_MAX_LENGTH);
  });

  it('bounds a long Cyrillic string to the byte limit', () => {
    const cyr = 'п'.repeat(ANALYTICS_FIELD_MAX_LENGTH);
    const result = truncateAnalyticsField(cyr) as string;
    expect(utf8Bytes(result)).toBeLessThanOrEqual(ANALYTICS_FIELD_MAX_LENGTH);
  });

  it('never leaves a lone surrogate when truncating astral-plane characters', () => {
    // 4 UTF-8 bytes each, so the boundary lands mid-character for some counts.
    for (let extra = 0; extra < 4; extra++) {
      const emoji = '🐛'.repeat(ANALYTICS_FIELD_MAX_LENGTH) + 'a'.repeat(extra);
      const result = truncateAnalyticsField(emoji) as string;

      expect(utf8Bytes(result)).toBeLessThanOrEqual(ANALYTICS_FIELD_MAX_LENGTH);
      // A lone surrogate is any D800–DFFF code unit not paired correctly.
      // `isWellFormed` is the standard check for exactly that.
      expect((result as any).isWellFormed()).toBe(true);
      expect(result).not.toMatch(/�/);
    }
  });

  it('still behaves exactly as before for plain ASCII', () => {
    const ascii = 'a'.repeat(ANALYTICS_FIELD_MAX_LENGTH + 500);
    const result = truncateAnalyticsField(ascii) as string;
    expect(result).toBe('a'.repeat(ANALYTICS_FIELD_MAX_LENGTH));
  });
});

// The old handler ran `CREATE TABLE IF NOT EXISTS SiteVisit` on every request,
// so it self-healed in any environment. The new one assumes migration 0008 is
// applied. If it is not, EVERY anonymous visit 500s, and the only client
// (`AnalyticsTracker.tsx`) swallows the failure with `.catch(() => {})` — so
// the loss is 100% and completely silent unless the Worker logs it. This suite
// runs in a pool with no D1 migrations, so the table really is absent: that is
// the exact condition under test.
describe('POST /analytics/visit surfaces a missing SiteVisit table server-side', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an operator-recognisable message naming SiteVisit and the migration', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await SELF.fetch('http://worker/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/stamps/peru', referrer: null }),
    });

    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toMatch(/analytics\/visit/);
    expect(logged).toMatch(/SiteVisit/);
    expect(logged).toMatch(/0008_create_site_visit\.sql/);
  });

  it('keeps the client-visible response shape unchanged (no extra detail leaked)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await SELF.fetch('http://worker/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/stamps/peru', referrer: null }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body).not.toHaveProperty('migration');
  });
});
