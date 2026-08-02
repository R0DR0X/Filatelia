import { describe, it, expect, vi, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';

// `getAuthenticatedUser` (src/index.ts) used to fall back to a hardcoded
// "demo-user-id" identity whenever the token looked "short", equaled the
// literal string "demo-token", or Supabase was unreachable/erroring. Any of
// these let an unauthenticated or failed-auth caller obtain a valid identity.
// These tests exercise the real fetch handler through the /price-alert route,
// which is the only route currently wired to getAuthenticatedUser.

describe('GET /price-alert authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 when no Authorization header is present', async () => {
    const res = await SELF.fetch('http://worker/price-alert');
    expect(res.status).toBe(401);
  });

  it('returns 401 for the literal "demo-token" instead of a demo identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    );

    const res = await SELF.fetch('http://worker/price-alert', {
      headers: { Authorization: 'Bearer demo-token' },
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 for a short/malformed token instead of a demo identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    );

    const res = await SELF.fetch('http://worker/price-alert', {
      headers: { Authorization: 'Bearer short' },
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid/expired token rejected by Supabase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    );

    const res = await SELF.fetch('http://worker/price-alert', {
      headers: { Authorization: 'Bearer invalid-or-expired-token-0123456789' },
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 when the Supabase auth check is unreachable, never a usable identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const res = await SELF.fetch('http://worker/price-alert', {
      headers: { Authorization: 'Bearer some-otherwise-well-formed-token-123456' },
    });

    expect(res.status).toBe(401);
  });
});
