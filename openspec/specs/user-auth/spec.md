# User Auth Specification

## Purpose

Unify identity under the Next app (`filatelia-web`) as sole session authority, backed
by the shared D1 `User` table. Replaces three parallel identity paths (Next `fp_session`,
Worker `fp_session`, `fp_token`/Bearer) with one signed, expiring `fp_session` cookie.

## Non-Goals

- Password reset, email verification flow, rate limiting on auth endpoints.
- Supabase adoption or `/price-alert` reachability.
- `/api/bids` impersonation fix (already shipped, commit 08e3fe4).
- Any Worker endpoint other than `/auth/*`.

## Requirements

### Requirement: Credential Login
The system MUST authenticate `POST /api/auth/login` against the D1 `User` table using
the existing PBKDF2-SHA256 (100000 iterations, `salt:hash` hex format) scheme, comparing
digests in constant time. It MUST NOT reuse the existing `verifyPassword`'s short-circuit
`===` comparison.

#### Scenario: Valid credentials
- GIVEN a `User` row with a valid PBKDF2 hash
- WHEN the matching email and password are submitted
- THEN the system issues an `fp_session` cookie with the user's `id` and resolved `role`

#### Scenario: Wrong password
- GIVEN a valid email
- WHEN the password does not match
- THEN the system returns 401 and issues no cookie, in time not observably correlated to hash prefix match

#### Scenario: Unknown email
- WHEN the submitted email has no `User` row
- THEN the system returns 401 with a generic error, indistinguishable from wrong-password

### Requirement: Registration
The system MUST provide `POST /api/auth/register` that creates a `User` row with a
PBKDF2 hash in the existing format and MUST reject duplicate emails.

#### Scenario: New registration
- WHEN a new email/password is submitted
- THEN a `User` row is created and an `fp_session` cookie is issued

#### Scenario: Duplicate email
- GIVEN an email already present in `User`
- WHEN registration is submitted with that email
- THEN the system returns 409 and creates no row

### Requirement: Google OAuth Upsert
`/api/auth/google` MUST upsert the D1 `User` row by email (create if absent, reuse if
present) instead of minting an ephemeral, unpersisted identity.

#### Scenario: Returning Google user
- GIVEN a `User` row already exists for the OAuth email (e.g. the current admin row)
- WHEN that user completes Google OAuth
- THEN the system reuses that row's `id` and role on every login, not a new ephemeral one

#### Scenario: First-time Google user
- WHEN no `User` row exists for the OAuth email
- THEN the system creates one and issues a session for it

### Requirement: Role Resolution
Session `role` claims MUST be derived by joining `UserRole`/`Role` for the user's `id`,
never read from a `role` column on `User` (no such column exists). At session-issuance time
(login, register, OAuth), the system queries the `UserRole`/`Role` join and bakes the
resolved role into the token claim. The admin proxy MUST re-verify the role against current
D1 state before forwarding to the Worker (not trust the baked session claim), so that
revoked admins lose access immediately rather than retaining it for up to 30 days.

#### Scenario: Admin resolves correctly
- GIVEN the existing admin `User` row has a `UserRole` entry for `admin`
- WHEN a session is issued for that user
- THEN the `role` claim is `admin`

#### Scenario: Admin role revocation is effective
- GIVEN an admin user whose `UserRole` link was deleted from D1
- WHEN the admin makes a request to `/api/admin/*` through the Next proxy
- THEN the proxy re-queries D1, finds no `admin` role, and denies access (403)
- AND the user's `fp_session` cookie is still valid elsewhere (e.g., `/api/bids`), but not for admin routes

#### Scenario: No role assigned
- GIVEN a `User` with no `UserRole` rows
- WHEN a session is issued
- THEN the `role` claim SHOULD default to `collector`

### Requirement: Session Issuance and Expiry
`signSession` MUST include an `exp` claim. Decided: 30-day lifetime with SLIDING
RENEWAL — every authenticated request that passes through `src/middleware.ts`
reissues `fp_session` with a fresh `iat`/`exp` computed at that moment, so a
session in continuous use does not expire from mere inactivity inside that
30-day window. Renewal is NOT unbounded: the system MUST also enforce a 90-day
ABSOLUTE ceiling measured from original issuance (`origIat`, stored in the token),
so an actively used session MUST still be refused once it passes that ceiling.
`signSession` is the sole source of `iat`/`exp`; it discards any caller-supplied
values and always computes its own.
`APP_SECRET` MUST be a required environment value with no fallback in production;
the app MUST fail fast at startup if it is unset in a production environment.

#### Scenario: Session issued with expiry
- WHEN any login/register/OAuth flow issues `fp_session`
- THEN the JWT payload includes `exp` set to issuance time plus the configured lifetime
- AND the original issuance timestamp (`origIat`) is preserved for absolute ceiling verification

#### Scenario: Continuously renewed session hits the absolute ceiling
- GIVEN a session that has been renewed often enough that `exp` is always fresh
- WHEN more than 90 days have passed since its ORIGINAL issuance (`origIat`)
- THEN verification MUST fail and the user MUST log in again, despite the fresh `exp`

#### Scenario: Missing APP_SECRET in production
- GIVEN `NODE_ENV=production` and `APP_SECRET` unset
- WHEN the app attempts to sign or verify a session
- THEN the system MUST fail fast rather than fall back to a default secret

### Requirement: Session Verification
`verifySession` MUST reject cookies that are unsigned, tampered, signed with a
different secret, or expired. It MUST also check the 90-day absolute ceiling using the
preserved `origIat` claim.

#### Scenario: Expired session
- GIVEN a cookie whose `exp` is in the past
- WHEN a protected route verifies it
- THEN the request is treated as unauthenticated

#### Scenario: Tampered cookie
- GIVEN a cookie payload altered after signing
- WHEN verified
- THEN verification fails

#### Scenario: Cookie signed with an old/rotated secret
- GIVEN a cookie signed under a previous `APP_SECRET`
- WHEN verified against the current secret
- THEN verification fails

#### Scenario: Missing session
- WHEN no `fp_session` cookie is present on a protected route
- THEN the request is treated as unauthenticated

#### Scenario: Session exceeds absolute ceiling
- GIVEN a valid, unexpired session with `origIat` more than 90 days in the past
- WHEN the system verifies it
- THEN verification fails, even if `exp` is still in the future

### Requirement: Logout
The system MUST provide a logout action that clears `fp_session` such that the browser
no longer sends a valid session cookie.

#### Scenario: Logout clears session
- GIVEN an authenticated session
- WHEN logout is invoked
- THEN a subsequent request has no valid `fp_session`

### Requirement: Admin Access via Session
All seven admin pages MUST authenticate via `fp_session` plus role check and MUST NOT
read `fp_token` from `localStorage` or send `Authorization: Bearer` to the Worker.
Admin routes are guarded by a Next proxy that verifies the session and re-validates the
admin role against D1 before forwarding, using a service token (`X-Admin-Token`) for
Worker communication.

#### Scenario: Admin page with valid session and role
- GIVEN an authenticated session with `role: admin` and an admin role in D1
- WHEN an admin page loads
- THEN it renders using the session, with no `fp_token` read

#### Scenario: Non-admin session on admin page
- GIVEN an authenticated session with `role: collector`
- WHEN accessing an admin page
- THEN the system denies access

#### Scenario: Admin page with stale session (role revoked in D1)
- GIVEN an authenticated session that was issued with `role: admin`
- BUT the user's `UserRole` link was subsequently deleted from D1
- WHEN accessing an admin page through the proxy
- THEN the proxy re-queries D1, detects no admin role, and returns 403

### Requirement: Non-Regression of Existing Consumers
`/api/collection` and `/api/match` MUST continue to authenticate via `fp_session` and
`payload.id` exactly as before this change.

#### Scenario: Collection endpoint unaffected
- GIVEN a valid `fp_session` cookie issued under the new system
- WHEN `/api/collection` is called
- THEN it resolves the user via `payload.id` and behaves as it did previously

### Requirement: Worker Auth Removal
Worker `/auth/register|login|logout|me` MUST be deleted, and the committed
`JWT_SECRET` MUST be removed from `wrangler.toml`, only after admin pages are migrated
to `fp_session` (per rollout ordering in the proposal).

#### Scenario: Worker auth routes removed
- WHEN `/auth/*` is requested on the Worker after this change ships
- THEN the response is 404

## Open Decisions (resolved and recorded)

- **Session lifetime**: DECIDED — 30 days, sliding renewal on every authenticated
  request through `src/middleware.ts` (protected pages: `/admin/:path*`,
  `/perfil`), bounded by a 90-day absolute cap: unbounded
  renewal let a session, and the `role` claim baked into it, live forever, so
  the cap is what makes revocation eventually total even if every other layer
  fails. API routes that call `verifySession` directly
  (`/api/collection`, `/api/match`, `/api/bids`) do NOT currently renew the
  cookie on their own responses — renewal happens at the middleware layer
  only. Revisit if product wants renewal on every API call too.

- **Admin role revocation**: DECIDED during E3 (later extension) — the admin proxy
  MUST re-query D1 to verify the current role, not trust the role claim baked into
  the session at issuance time. This makes revocation immediate rather than
  caching the admin permission for up to 30 more days after removal.

- **Registration gating**: DECIDED — open to anyone, no invitation gating.

- **Email verification**: This spec does NOT block login on verification status —
  an unverified account MAY authenticate. Revisit if verification enforcement
  becomes a requirement.

## Implementation Notes

- Task 0.1 (verify prod admin PBKDF2 hash): REQUIRES operator access to D1; not executable by this agent.
- Task 0.2 (seed admin role): migration `0007_seed_admin_role.sql` was written but not executed against remote D1; requires operator with `wrangler` credentials.
- Migration 0008 (`create_site_visit.sql`): required by E2 follow-up work that moved `/analytics/visit` DDL off the hot path.
- Service token (`ADMIN_API_TOKEN`): provisioned on Worker secret, Pages environment variables (prod + preview), and scraper hosts; not yet smoke-tested through browser UI.
- Compromised `JWT_SECRET` (`fp-secret-2024-filatelia-peruana-secure`): removed from code but remains in git history; an operator must rotate it from all live deployed Worker versions.
