// D1-backed access for the `User`/`Role`/`UserRole` tables
// (workers/filatelia-api/schema.sql). Follows the same direct-binding
// pattern as src/lib/db/collection.ts: no network fallback, no SQL gateway.
//
// The `User` table has NO `role` column. Role is always resolved by joining
// `UserRole`/`Role`; a user with no `UserRole` row resolves to "collector",
// never "admin" (Role Resolution requirement).

const DEFAULT_ROLE = 'collector';

export interface AuthUserRecord {
  id: string;
  name: string | null;
  email: string;
  password: string | null;
  role: string;
}

/** Thrown when Google reports the profile email as unverified. */
export class GoogleEmailUnverifiedError extends Error {
  constructor() {
    super('Google has not verified this email address.');
    this.name = 'GoogleEmailUnverifiedError';
  }
}

function getD1(): any {
  const d1 = (process.env as any).DB;
  if (!d1 || typeof d1.prepare !== 'function') {
    throw new Error(
      "D1 binding 'DB' is unavailable in this environment. Run this code where the D1 binding is attached (e.g. `wrangler pages dev`)."
    );
  }
  return d1;
}

/** Resolves a user's role via UserRole/Role. No row -> "collector". */
export async function resolveUserRole(userId: string): Promise<string> {
  const d1 = getD1();
  const row = await d1
    .prepare(
      'SELECT Role.name AS name FROM UserRole JOIN Role ON UserRole.roleId = Role.id WHERE UserRole.userId = ? LIMIT 1'
    )
    .bind(userId)
    .first();
  return row?.name || DEFAULT_ROLE;
}

/** Finds a User row by email and attaches its resolved role. Null if absent. */
export async function findUserByEmail(email: string): Promise<AuthUserRecord | null> {
  const d1 = getD1();
  const row = await d1.prepare('SELECT id, name, email, password FROM User WHERE email = ?').bind(email).first();
  if (!row) return null;

  const role = await resolveUserRole(row.id);
  return { id: row.id, name: row.name ?? null, email: row.email, password: row.password ?? null, role };
}

/** Finds a User row by id and attaches its resolved role. Null if absent. */
export async function findUserById(id: string): Promise<AuthUserRecord | null> {
  const d1 = getD1();
  const row = await d1.prepare('SELECT id, name, email, password FROM User WHERE id = ?').bind(id).first();
  if (!row) return null;

  const role = await resolveUserRole(row.id);
  return { id: row.id, name: row.name ?? null, email: row.email, password: row.password ?? null, role };
}

/** Creates a new User row with a pre-hashed password. No role row -> "collector". */
export async function createUser(params: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<AuthUserRecord> {
  const d1 = getD1();
  const id = `usr_${crypto.randomUUID()}`;

  await d1
    .prepare('INSERT INTO User (id, name, email, password) VALUES (?, ?, ?, ?)')
    .bind(id, params.name, params.email, params.passwordHash)
    .run();

  return { id, name: params.name, email: params.email, password: params.passwordHash, role: DEFAULT_ROLE };
}

/**
 * Upserts a User row by email for Google OAuth sign-in: reuses the existing
 * row/role for a returning email, creates a new (passwordless) row for a
 * first-time email.
 *
 * SECURITY — account pre-hijacking. Do NOT "simplify" either guard below.
 *
 * 1. `verifiedEmail` must be true: an unverified Google email is not proof of
 *    ownership, so it must never adopt or create an account.
 * 2. A password on a matched row was set by a registration flow that never
 *    proved email ownership, so an attacker can pre-register `victim@gmail.com`
 *    and keep access via POST /api/auth/login after the real owner signs in
 *    with Google. Linking therefore clears `password` to NULL: the owner keeps
 *    access through Google, the unproven credential dies. Refusing the link
 *    instead would let an attacker permanently lock a victim out of their own
 *    email-keyed account, trading one vulnerability for another.
 */
export async function upsertGoogleUser(params: {
  email: string;
  name: string;
  verifiedEmail: boolean;
}): Promise<AuthUserRecord> {
  if (!params.verifiedEmail) {
    throw new GoogleEmailUnverifiedError();
  }

  const existing = await findUserByEmail(params.email);
  if (existing) {
    if (existing.password !== null) {
      const d1 = getD1();
      await d1.prepare('UPDATE User SET password = NULL WHERE id = ?').bind(existing.id).run();
    }
    return { ...existing, password: null };
  }

  const d1 = getD1();
  const id = `usr_${crypto.randomUUID()}`;

  await d1.prepare('INSERT INTO User (id, name, email) VALUES (?, ?, ?)').bind(id, params.name, params.email).run();

  return { id, name: params.name, email: params.email, password: null, role: DEFAULT_ROLE };
}
