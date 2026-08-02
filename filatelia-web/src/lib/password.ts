// PBKDF2-SHA256 password hashing, matching the existing production format
// exactly (`saltHex:hashHex`, 16-byte salt, 32-byte digest, 100000
// iterations) so the one real production password hash keeps working with
// zero migration. Uses Web Crypto only — this runs on the Cloudflare edge
// runtime, which has no Node `crypto` module.
//
// Comparison is constant-time (XOR-accumulate over the decoded digest
// bytes) — this deliberately does NOT reuse the pattern from the Worker's
// `verifyPassword` (workers/filatelia-api/src/index.ts), which compares
// hex strings with `===` and leaks timing information.

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DIGEST_BITS = 256;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const matches = hex.match(/.{2}/g);
  if (!matches) return null;
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

async function deriveBits(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    DIGEST_BITS
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

/** Hashes a password into the `saltHex:hashHex` format used by production. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const digest = await deriveBits(password, salt);
  return `${toHex(salt)}:${toHex(digest)}`;
}

/**
 * Verifies a password against a stored `saltHex:hashHex` value in constant
 * time. Returns `false` (never throws) for malformed stored values.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = (stored || '').split(':');
  if (!saltHex || !hashHex) return false;

  const salt = fromHex(saltHex);
  const expected = fromHex(hashHex);
  if (!salt || !expected) return false;

  const attempt = await deriveBits(password, salt);
  return constantTimeEqual(attempt, expected);
}
