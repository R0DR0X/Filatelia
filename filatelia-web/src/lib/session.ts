// Session token issuance and verification for the `fp_session` cookie.
//
// Lifetime: 30 days with SLIDING RENEWAL — each verified authenticated use
// (see src/middleware.ts) reissues the cookie with a fresh 30-day `exp`.
// `signSession` always computes its own `iat`/`exp`; callers cannot forge an
// arbitrary expiry through the payload.
//
// Absolute cap: sliding renewal alone lets a session live forever as long as
// it is used at least once every 30 days. To bound that, every token also
// carries `origIat` — the timestamp of the ORIGINAL issuance, preserved
// across renewals — and `verifySession` refuses a token once
// `now - origIat > ABSOLUTE_SESSION_TTL_SECONDS` (90 days), regardless of how
// fresh `exp` is. The user must log in again past that point. 90 days is
// generous enough not to interrupt a genuinely active user (who re-logs in
// far less often than that in practice) while bounding how long a token
// compromised once, or a revoked role baked into a claim, can keep renewing.
//
// `origIat` is only ever trusted from a payload that already passed
// `verifySession`'s HMAC check on a prior request (i.e. the renewal path in
// src/middleware.ts) — never from arbitrary caller input. As defense in
// depth, `signSession` itself also refuses to honor an incoming `origIat`
// that lies in the future: it is only preserved when it is <= the fresh
// `iat` being issued, otherwise it is reset to `iat`. This makes it
// impossible for a caller to "extend" a session's absolute cap by simply
// passing a manufactured, future-dated `origIat` into the payload.
//
// Legacy tokens issued before this change carry no `origIat` claim.
// `verifySession` treats a missing `origIat` as "no absolute cap applies
// yet" rather than rejecting the token outright — mass-invalidating every
// session in flight the moment this ships would be a self-inflicted outage,
// not a security requirement. The first time such a token is renewed,
// `signSession` stamps it with a fresh `origIat` (see above), so it becomes
// capped going forward from that point. Worst case, a pre-existing session
// keeps sliding for up to one more `SESSION_TTL_SECONDS` (30 days) window
// before the cap starts applying to it.
//
// Secret: `APP_SECRET` is required. In production, signing or verifying
// without it throws immediately (fail-fast) instead of falling back to a
// well-known default secret. Outside production, a fixed dev fallback keeps
// local development working without extra setup.

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const ABSOLUTE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

const DEV_FALLBACK_SECRET = 'dev-secret-only-change-in-prod';

function getAppSecret(): string {
  const secret = process.env.APP_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_SECRET is required in production. Refusing to sign or verify sessions with a fallback secret.'
    );
  }
  return DEV_FALLBACK_SECRET;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function getSecretKey() {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(getAppSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function base64UrlEncode(bytes: Uint8Array<ArrayBuffer>) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Signs a session payload. Any `iat`/`exp` present on the input payload is
 * discarded — this function is the sole source of truth for session expiry,
 * always issuing a fresh `iat` and `exp` computed from `ttlSeconds`
 * (defaults to `SESSION_TTL_SECONDS`, i.e. 30 days). Passing a negative
 * `ttlSeconds` is only meaningful for tests that need an already-expired
 * token.
 */
export async function signSession(
  payload: Record<string, any>,
  options: { ttlSeconds?: number } = {}
): Promise<string> {
  const { iat: _iat, exp: _exp, origIat: incomingOrigIat, ...rest } = payload;
  const ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  const iat = nowSeconds();
  const exp = iat + ttlSeconds;
  // Preserve the original issuance time across renewals (see module header
  // for the absolute-cap rationale). Only honor an incoming `origIat` when
  // it cannot possibly extend the cap, i.e. it is not in the future relative
  // to the fresh `iat` being issued right now; otherwise treat this as a
  // first issuance and stamp `origIat` from the current clock.
  const origIat =
    typeof incomingOrigIat === 'number' && incomingOrigIat <= iat ? incomingOrigIat : iat;
  const fullPayload = { ...rest, origIat, iat, exp };

  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(fullPayload)));

  const dataToSign = `${headerB64}.${payloadB64}`;
  const key = await getSecretKey();

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(dataToSign)
  );
  const signatureB64 = base64UrlEncode(new Uint8Array(signatureBuffer));

  return `${dataToSign}.${signatureB64}`;
}

/**
 * Verifies a session token: signature, structure, and expiry. Returns the
 * decoded payload only when the signature is valid AND `exp` is present and
 * in the future AND `id` is present (the canonical identity key every
 * consumer — `/api/collection`, `/api/bids`, `/api/match`, middleware —
 * relies on). Any failure returns `null`, never throws.
 */
export async function verifySession(token: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const dataToVerify = `${headerB64}.${payloadB64}`;

    const signatureBuffer = base64UrlDecode(signatureB64);
    const key = await getSecretKey();
    const enc = new TextEncoder();

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      enc.encode(dataToVerify)
    );

    if (!isValid) return null;

    const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadStr);

    if (typeof payload.exp !== 'number' || payload.exp < nowSeconds()) return null;
    if (typeof payload.id !== 'string' || !payload.id) return null;

    // Absolute cap: reject regardless of how fresh `exp` is once the
    // ORIGINAL issuance is more than ABSOLUTE_SESSION_TTL_SECONDS in the
    // past. A missing `origIat` (legacy token issued before this claim
    // existed) is grandfathered in — see module header.
    if (typeof payload.origIat === 'number' && nowSeconds() - payload.origIat > ABSOLUTE_SESSION_TTL_SECONDS) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}
