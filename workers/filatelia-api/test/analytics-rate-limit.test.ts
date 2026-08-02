import { describe, it, expect, vi, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { checkAnalyticsRateLimit, getAnalyticsRateLimitKey } from '../src/index';

// `POST /analytics/visit` is unauthenticated by design (see `src/index.ts`),
// so IP is the only available signal to throttle a flood — there is no user
// identity to key on. These tests exercise the rate-limit logic directly
// (`checkAnalyticsRateLimit` / `getAnalyticsRateLimitKey`) rather than only
// through HTTP, because this suite's D1 pool has no migrations: ANY request
// that reaches the `SiteVisit` INSERT 500s with "no such table", which would
// make an HTTP-only assertion pass for the wrong reason (a prior review in
// this repo already caught exactly that mistake). Asserting on the extracted
// functions proves the actual rate-limit behavior regardless of D1 state.

describe('getAnalyticsRateLimitKey', () => {
  it('uses the CF-Connecting-IP header when present', () => {
    const req = new Request('http://worker/analytics/visit', {
      headers: { 'CF-Connecting-IP': '203.0.113.7' },
    });
    expect(getAnalyticsRateLimitKey(req)).toBe('203.0.113.7');
  });

  it('falls back to a constant key when the header is absent, so every header-less caller shares one bucket', () => {
    const req = new Request('http://worker/analytics/visit');
    const key = getAnalyticsRateLimitKey(req);
    expect(key).toBe(getAnalyticsRateLimitKey(new Request('http://worker/analytics/visit')));
    expect(key).not.toBe('');
  });
});

describe('checkAnalyticsRateLimit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows the request when the limiter reports success', async () => {
    const limiter = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const allowed = await checkAnalyticsRateLimit(limiter as any, 'some-key');
    expect(allowed).toBe(true);
    expect(limiter.limit).toHaveBeenCalledWith({ key: 'some-key' });
  });

  it('denies the request when the limiter reports failure', async () => {
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const allowed = await checkAnalyticsRateLimit(limiter as any, 'some-key');
    expect(allowed).toBe(false);
  });

  it('degrades to allowed and logs when the binding is absent (older deployment, local dev, test pool)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const allowed = await checkAnalyticsRateLimit(undefined, 'some-key');
    expect(allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toMatch(/ANALYTICS_LIMITER/);
  });
});

describe('POST /analytics/visit — 429 short-circuits before D1 is touched', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 429 and never prepares a D1 statement when the limiter denies the request', async () => {
    const db = (await import('cloudflare:test')).env.DB as D1Database;
    const originalPrepare = db.prepare.bind(db);
    const prepareSpy = vi.fn((sql: string) => originalPrepare(sql));
    (db as any).prepare = prepareSpy;

    const deniedLimiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    (await import('cloudflare:test')).env.ANALYTICS_LIMITER = deniedLimiter as any;

    try {
      const res = await SELF.fetch('http://worker/analytics/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.9' },
        body: JSON.stringify({ path: '/stamps/peru', referrer: null }),
      });

      expect(res.status).toBe(429);
      expect(prepareSpy).not.toHaveBeenCalled();
      expect(deniedLimiter.limit).toHaveBeenCalledWith({ key: '198.51.100.9' });
    } finally {
      (db as any).prepare = originalPrepare;
      delete (await import('cloudflare:test')).env.ANALYTICS_LIMITER;
    }
  });
});
