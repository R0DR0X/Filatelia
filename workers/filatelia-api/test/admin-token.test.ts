import { describe, it, expect, vi, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { requireAdmin } from '../src/index';

// `requireAdmin` (src/index.ts) is token-only: it accepts a
// service-to-service caller (the Next admin proxy) presenting
// `X-Admin-Token` that matches the `ADMIN_API_TOKEN` Worker secret, compared
// in constant time, and rejects everything else. The legacy
// `fp_session`-cookie-based admin checks (and the privilege-escalation rules
// they carried) were deleted — see test/auth-removal.test.ts for that
// regression coverage. `ADMIN_API_TOKEN` is set to a known test value in
// vitest.config.mts for this suite.
//
// `/admin/stamps` is used as the representative `/admin/*` route.

const ADMIN_ROUTE = 'http://worker/admin/stamps';
const VALID_TOKEN = 'test-admin-service-token-0123456789';

describe('requireAdmin service token only (no cookie fallback)', () => {
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

  it('rejects a request with no X-Admin-Token (there is no other admin path anymore)', async () => {
    const res = await SELF.fetch(ADMIN_ROUTE);

    expect(res.status).toBe(403);
  });
});

// `/admin/seed-countries` bulk-inserts into `Country`. It must be gated by
// the same token-only `requireAdmin` as every other `/admin/*` route: an
// unauthenticated caller reaching the Worker directly must never be able to
// mutate the catalog.
describe('POST /admin/seed-countries authorization', () => {
  it('rejects an unauthenticated POST with 403 and never touches the database', async () => {
    const res = await SELF.fetch('http://worker/admin/seed-countries', { method: 'POST' });

    expect(res.status).toBe(403);
  });

  it('rejects a POST bearing a wrong X-Admin-Token with 403', async () => {
    const res = await SELF.fetch('http://worker/admin/seed-countries', {
      method: 'POST',
      headers: { 'X-Admin-Token': 'wrong-token' },
    });

    expect(res.status).toBe(403);
  });

  it('does not reject with 403 a POST bearing the correct X-Admin-Token', async () => {
    const res = await SELF.fetch('http://worker/admin/seed-countries', {
      method: 'POST',
      headers: { 'X-Admin-Token': VALID_TOKEN },
    });

    expect(res.status).not.toBe(403);
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

// Post-PR4 there is no admin fallback path, so an `ADMIN_API_TOKEN` mismatch
// between the Worker secret and the Pages env var fails 100% of admin actions
// with a 403 that is byte-identical to a legitimate permission denial. The
// Worker must therefore leave a server-side trace distinguishing "no header"
// from "header present but mismatched" — without ever logging the token value
// or any prefix of it.
describe('requireAdmin service-token failure logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an absent-header rejection without any token material', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await requireAdmin(stubContext({}, { ADMIN_API_TOKEN: VALID_TOKEN }));

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].map(String).join(' ');
    expect(logged).toContain('absent');
    expect(logged).not.toContain(VALID_TOKEN);
    expect(logged).not.toContain(VALID_TOKEN.slice(0, 6));
  });

  it('logs a mismatched-header rejection distinctly, without any token material', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await requireAdmin(stubContext({ 'X-Admin-Token': 'wrong-token' }, { ADMIN_API_TOKEN: VALID_TOKEN }));

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].map(String).join(' ');
    expect(logged).toContain('mismatch');
    expect(logged).not.toContain('wrong-token');
    expect(logged).not.toContain(VALID_TOKEN);
    expect(logged).not.toContain(VALID_TOKEN.slice(0, 6));
  });

  it('logs an unconfigured-secret rejection distinctly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await requireAdmin(stubContext({ 'X-Admin-Token': 'anything' }, {}));

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].map(String).join(' ');
    expect(logged).toContain('not configured');
    expect(logged).not.toContain('anything');
  });

  it('logs nothing on the happy path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await requireAdmin(stubContext({ 'X-Admin-Token': VALID_TOKEN }, { ADMIN_API_TOKEN: VALID_TOKEN }));

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
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
