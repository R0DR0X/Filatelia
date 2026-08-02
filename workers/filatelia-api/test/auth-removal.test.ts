import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { requireAdmin } from '../src/index';

// The Worker used to be its own identity authority (JWT-backed `/auth/*`
// routes, an `fp_session` cookie verified with `JWT_SECRET`). That authority
// moved to the Next app (see openspec/changes/unified-session). This suite
// proves the legacy routes are gone (404, not just unauthenticated) and that
// the two privilege-escalation rules that used to live inside `requireAdmin`
// (an `@filateliaperuana.com` email, or being the sole row in `User`) can no
// longer grant admin now that `requireAdmin` is token-only.

const VALID_TOKEN = 'test-admin-service-token-0123456789';

// Mirrors the (now-deleted) Worker `createJWT`/fallback-secret format exactly,
// so these regression tests can forge a legacy `fp_session` cookie without
// importing anything from src/index.ts that this PR deletes. This is the
// SAME fallback secret `getAuthUser` used when `env.JWT_SECRET` was unset —
// i.e. this is the token an attacker could trivially forge in the old code,
// which is precisely why the cookie path had to go.
const LEGACY_FALLBACK_SECRET = 'fp-secret-2024-filatelia-peruana-secure';

async function forgeLegacyFpSessionCookie(payload: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })
  );
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(LEGACY_FALLBACK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `fp_session=${header}.${body}.${sigStr}`;
}

describe('Worker /auth/* routes are removed', () => {
  it('POST /auth/register returns 404', async () => {
    const res = await SELF.fetch('http://worker/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', email: 'x@example.com', password: 'password123' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /auth/login returns 404', async () => {
    const res = await SELF.fetch('http://worker/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'password123' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /auth/logout returns 404', async () => {
    const res = await SELF.fetch('http://worker/auth/logout', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('GET /auth/me returns 404', async () => {
    const res = await SELF.fetch('http://worker/auth/me');
    expect(res.status).toBe(404);
  });
});

// stubContext mirrors the helper in admin-token.test.ts: a minimal fake Hono
// context exercising `requireAdmin` directly at the unit level.
function stubContext(headers: Record<string, string>, env: Record<string, any>) {
  return {
    req: {
      header: (name: string) => headers[name],
    },
    env,
  };
}

describe('requireAdmin regression: legacy privilege-escalation rules are gone', () => {
  it('does NOT grant admin to a forged @filateliaperuana.com cookie identity anymore (cookie path deleted, no X-Admin-Token)', async () => {
    let dbTouched = false;
    const forgedCookie = await forgeLegacyFpSessionCookie({
      sub: 'attacker-id',
      email: 'attacker@filateliaperuana.com',
      name: 'Attacker',
      role: 'collector',
    });
    const ctx = stubContext(
      { Cookie: forgedCookie },
      {
        JWT_SECRET: undefined, // env unset -> old code used the forgeable fallback secret above
        ADMIN_API_TOKEN: VALID_TOKEN,
        DB: {
          prepare: () => {
            dbTouched = true;
            throw new Error('requireAdmin must never query the User table anymore');
          },
        },
      }
    );

    const admin = await requireAdmin(ctx);

    expect(admin).toBeNull();
    expect(dbTouched).toBe(false);
  });

  it('does NOT grant admin merely because User has exactly one row, even with a forged non-admin cookie (first-user rule deleted, no X-Admin-Token)', async () => {
    let dbTouched = false;
    const forgedCookie = await forgeLegacyFpSessionCookie({
      sub: 'sole-user-id',
      email: 'someone@example.com',
      name: 'Sole User',
      role: 'collector',
    });
    const ctx = stubContext(
      { Cookie: forgedCookie },
      {
        JWT_SECRET: undefined,
        ADMIN_API_TOKEN: VALID_TOKEN,
        DB: {
          prepare: () => {
            dbTouched = true;
            return { first: async () => ({ cnt: 1 }) };
          },
        },
      }
    );

    const admin = await requireAdmin(ctx);

    expect(admin).toBeNull();
    expect(dbTouched).toBe(false);
  });

  it('still grants admin via the correct X-Admin-Token, unaffected by DB state', async () => {
    const ctx = stubContext(
      { 'X-Admin-Token': VALID_TOKEN },
      { ADMIN_API_TOKEN: VALID_TOKEN }
    );

    const admin = await requireAdmin(ctx);

    expect(admin).not.toBeNull();
    expect(admin.role).toBe('admin');
  });
});
