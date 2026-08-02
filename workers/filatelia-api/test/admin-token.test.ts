import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { requireAdmin } from '../src/index';

// `requireAdmin` (src/index.ts) must additionally accept a service-to-service
// caller (the Next admin proxy) presenting `X-Admin-Token` that matches the
// `ADMIN_API_TOKEN` Worker secret, compared in constant time. This must be
// purely additive: it must never disable or change the existing
// `fp_session`-cookie-based legacy admin checks. `ADMIN_API_TOKEN` is set to
// a known test value in vitest.config.mts for this suite.
//
// `/admin/stamps` is used as the representative `/admin/*` route.

const ADMIN_ROUTE = 'http://worker/admin/stamps';
const VALID_TOKEN = 'test-admin-service-token-0123456789';

describe('requireAdmin service token dual-accept', () => {
  // NOTE: this suite's pool has no D1 migrations, so `/admin/stamps` answers
  // 500 (`no such table: Stamp`) even when authorization succeeds. The HTTP
  // tests below can therefore only prove the *negative* (a 403 rejection);
  // the positive case is proven at unit level against `requireAdmin` itself,
  // further down, where the returned principal is observable.
  it('does not reject with 403 a request bearing the correct X-Admin-Token, without any session cookie', async () => {
    const res = await SELF.fetch(ADMIN_ROUTE, {
      headers: { 'X-Admin-Token': VALID_TOKEN },
    });

    expect(res.status).not.toBe(403);
  });

  it('rejects a request bearing a wrong X-Admin-Token and no session cookie', async () => {
    const res = await SELF.fetch(ADMIN_ROUTE, {
      headers: { 'X-Admin-Token': 'wrong-token' },
    });

    expect(res.status).toBe(403);
  });

  it('rejects a request with no X-Admin-Token and no session cookie (falls through to legacy cookie logic)', async () => {
    const res = await SELF.fetch(ADMIN_ROUTE);

    expect(res.status).toBe(403);
  });
});

// Unit-level coverage for the "empty === empty" trap: an unset/empty
// `ADMIN_API_TOKEN` in env must never let ANY header value (including an
// empty one) authorize. Exercised directly against `requireAdmin` with a
// stub Hono context, since the full request pool always has
// `ADMIN_API_TOKEN` set (see vitest.config.mts).
function stubContext(headers: Record<string, string>, env: Record<string, any>) {
  return {
    req: {
      header: (name: string) => headers[name],
    },
    env,
  };
}

describe('requireAdmin service token happy path (unit level)', () => {
  it('returns an admin service principal when X-Admin-Token matches ADMIN_API_TOKEN', async () => {
    const admin = await requireAdmin(
      stubContext({ 'X-Admin-Token': VALID_TOKEN }, { ADMIN_API_TOKEN: VALID_TOKEN })
    );

    expect(admin).not.toBeNull();
    expect(admin.role).toBe('admin');
    expect(admin.viaServiceToken).toBe(true);
  });

  it('returns null when the header token does not match the configured secret', async () => {
    const admin = await requireAdmin(
      stubContext({ 'X-Admin-Token': 'wrong-token' }, { ADMIN_API_TOKEN: VALID_TOKEN })
    );

    expect(admin).toBeNull();
  });
});

describe('requireAdmin with ADMIN_API_TOKEN unset in env', () => {
  it('never authorizes via the header path, even with a matching empty token', async () => {
    const admin = await requireAdmin(stubContext({ 'X-Admin-Token': '' }, { ADMIN_API_TOKEN: '' }));
    expect(admin).toBeNull();
  });

  it('never authorizes via the header path for any non-empty token when ADMIN_API_TOKEN is unset', async () => {
    const admin = await requireAdmin(stubContext({ 'X-Admin-Token': 'anything' }, {}));
    expect(admin).toBeNull();
  });
});
