// Session token issuance and verification for the `fp_session` cookie.
//
// Lifetime: 30 days with SLIDING RENEWAL — each verified authenticated use
// (see src/middleware.ts) reissues the cookie with a fresh 30-day `exp`.
// `signSession` always computes its own `iat`/`exp`; callers cannot forge an
// arbitrary expiry through the payload.
//
// Secret: `APP_SECRET` is required. In production, signing or verifying
// without it throws immediately (fail-fast) instead of falling back to a
// well-known default secret. Outside production, a fixed dev fallback keeps
// local development working without extra setup.

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

function base64UrlEncode(arrayBuffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
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
  const { iat: _iat, exp: _exp, ...rest } = payload;
  const ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  const iat = nowSeconds();
  const exp = iat + ttlSeconds;
  const fullPayload = { ...rest, iat, exp };

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
  const signatureB64 = base64UrlEncode(signatureBuffer);

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

    return payload;
  } catch (error) {
    return null;
  }
}
