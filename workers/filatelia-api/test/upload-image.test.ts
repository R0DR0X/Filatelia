import { describe, it, expect, vi, afterEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { WIKIMEDIA_UPLOAD_ALLOWLIST } from '../src/index';

// `POST /upload-image` used to be completely unauthenticated: anyone on the
// internet could write arbitrary bytes into the public R2 buckets (and,
// through the `url` field, make the Worker itself fetch and store an
// attacker-chosen URL — SSRF). It must now be guarded by `requireAdmin`,
// exactly like `/import-stamp`, and the `url` path must be restricted to an
// explicit host allowlist.
//
// `/admin/upload-image` is the same handler, additionally reachable through
// the Next admin proxy (which only forwards to Worker `/admin/<path>`).

const VALID_TOKEN = 'test-admin-service-token-0123456789';

describe('POST /upload-image authorization (regression for the unauthenticated R2 write hole)', () => {
  it('rejects with 403 a request with no credentials at all', async () => {
    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'x.jpg', data: 'aGVsbG8=' }),
    });

    expect(res.status).toBe(403);
  });

  it('does not reject with 403 a request bearing the correct X-Admin-Token', async () => {
    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'x.jpg', data: 'aGVsbG8=' }),
    });

    expect(res.status).not.toBe(403);
  });
});

describe('POST /admin/upload-image (proxy-reachable alias)', () => {
  it('rejects with 403 a request with no credentials at all', async () => {
    const res = await SELF.fetch('http://worker/admin/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'x.jpg', data: 'aGVsbG8=' }),
    });

    expect(res.status).toBe(403);
  });

  it('does not reject with 403 a request bearing the correct X-Admin-Token', async () => {
    const res = await SELF.fetch('http://worker/admin/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'x.jpg', data: 'aGVsbG8=' }),
    });

    expect(res.status).not.toBe(403);
  });
});

// The `url` path makes the Worker itself perform a fetch. Even behind admin
// auth this is a request-forgery primitive unless the target host is
// restricted to an explicit allowlist. `WIKIMEDIA_UPLOAD_ALLOWLIST` must be
// checked against the *parsed* URL's hostname (exact match or subdomain),
// never a substring check, so a lookalike host is rejected.
describe('POST /upload-image SSRF allowlist on the url path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts an allowlisted host and does not reject for host reasons', async () => {
    const allowedHost = WIKIMEDIA_UPLOAD_ALLOWLIST[0];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })
    );

    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'allowed.jpg', url: `https://${allowedHost}/some/image.jpg` }),
    });

    expect(res.status).not.toBe(400);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('rejects a non-https protocol with 400 and never fetches', async () => {
    const allowedHost = WIKIMEDIA_UPLOAD_ALLOWLIST[0];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'x.jpg', url: `http://${allowedHost}/some/image.jpg` }),
    });

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a lookalike host (evil-wikimedia.org) with 400 and never fetches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'x.jpg', url: 'https://evil-wikimedia.org/some/image.jpg' }),
    });

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a suffix-attack host (wikimedia.org.attacker.com) with 400 and never fetches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'x.jpg', url: 'https://wikimedia.org.attacker.com/some/image.jpg' }),
    });

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still accepts the base64 data path, unaffected by the allowlist', async () => {
    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'x.jpg', data: 'aGVsbG8=' }),
    });

    expect(res.status).not.toBe(400);
  });
});

// Validating only the URL the caller supplied is not enough. `fetch` defaults
// to `redirect: 'follow'`, and Workers follows 3xx across hosts transparently,
// so an allowlisted host that answers with a redirect (an open redirect, or a
// compromised/hostile response) would hand the Worker an arbitrary off-list
// host whose bytes then land in a PUBLIC R2 bucket. The host that actually
// serves the stored bytes must be allowlisted too, and that must be enforced
// at the point of storage — so these tests assert on the R2 `put` spy, not on
// the status code alone.
describe('POST /upload-image SSRF allowlist survives redirects', () => {
  let putSpy: ReturnType<typeof vi.fn>;
  let originalPut: any;

  const spyOnR2Put = () => {
    originalPut = (env.STAMPS_IMAGES as any).put;
    putSpy = vi.fn(async () => ({}));
    (env.STAMPS_IMAGES as any).put = putSpy;
  };

  afterEach(() => {
    if (originalPut) (env.STAMPS_IMAGES as any).put = originalPut;
    originalPut = undefined;
    vi.restoreAllMocks();
  });

  it('does NOT store anything when an allowlisted host answers 302 to a non-allowlisted host', async () => {
    const allowedHost = WIKIMEDIA_UPLOAD_ALLOWLIST[0];
    spyOnR2Put();
    // NOTE: the mock must CREATE the Response inside the call (not hoist it
    // via `mockResolvedValue`), because a body created in the test's request
    // context cannot be read from the Worker's request context.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example.com/internal-secret' },
        })
    );

    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'redirected.jpg', url: `https://${allowedHost}/some/image.jpg` }),
    });

    expect(putSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('does NOT store anything when the final response URL is a non-allowlisted host', async () => {
    const allowedHost = WIKIMEDIA_UPLOAD_ALLOWLIST[0];
    spyOnR2Put();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const landed = new Response(new Uint8Array([1, 2, 3]).buffer, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
      // A followed redirect surfaces as a 200 whose `url` is the FINAL host.
      Object.defineProperty(landed, 'url', { value: 'https://attacker.example.com/x.jpg' });
      return landed;
    });

    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'final-host.jpg', url: `https://${allowedHost}/some/image.jpg` }),
    });

    expect(putSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });

  it('still stores a direct 200 from an allowlisted host (the real Wikimedia case)', async () => {
    const allowedHost = WIKIMEDIA_UPLOAD_ALLOWLIST[1];
    spyOnR2Put();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const ok = new Response(new Uint8Array([1, 2, 3]).buffer, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
      Object.defineProperty(ok, 'url', { value: `https://${allowedHost}/wikipedia/commons/a/ab/x.jpg` });
      return ok;
    });

    const res = await SELF.fetch('http://worker/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': VALID_TOKEN },
      body: JSON.stringify({ key: 'direct.jpg', url: `https://${allowedHost}/wikipedia/commons/a/ab/x.jpg` }),
    });

    expect(res.status).toBe(200);
    expect(putSpy).toHaveBeenCalledTimes(1);
  });
});
