# Exploration: unified-session (Epic E1)

Status: done — ready for proposal
Artifact store: hybrid (also persisted to Engram under `sdd/unified-session/explore`)

## Summary

There are not two competing session systems. There are **three live ones plus one
orphaned**, and two of the four Next-side consumer routes have already, implicitly,
picked a winner. The task is therefore not "unify the cookie" but "name the identity
authority and delete the others".

## Current state

### 1. Next's own cookie session — `fp_session` signed with `APP_SECRET`

`filatelia-web/src/lib/session.ts:1-78` implements `signSession` / `verifySession`
(HMAC-SHA256 JWT). The secret is `process.env.APP_SECRET || 'dev-secret-only-change-in-prod'`
and is never overridden anywhere in `filatelia-web`.

Consumers:

- `src/app/api/auth/google/route.ts:40-57` issues it after a successful Google OAuth
  exchange, with payload `{ id: 'usr_'+googleId, name, email, picture, role: 'collector' }`,
  on the Pages app's own domain. **It is never persisted to D1** — no `User` row is
  created or looked up, so a returning Google user receives a fresh ephemeral identity
  on every login and is always `role: 'collector'`.
- `src/middleware.ts:5-9` reads and enforces it for `/admin/:path*` and `/perfil`.
- `src/app/api/collection/route.ts:9-17` and `src/app/api/match/route.ts:9-17` verify it
  correctly and use `payload?.id`. **These two routes already work today.**
- `src/app/api/auth/login/route.ts` GET (`:24-37`) verifies it, acting as a de facto
  `/api/auth/me`. POST is deliberately hardcoded to 501, replacing a prior
  any-password bypass.

This corrects the premise in PENDIENTES.md: it is not true that "only Google OAuth
works". It is that only Google OAuth issues a session Next trusts, and half of Next's
consumers already consume that session correctly.

### 2. The Worker's own session — `fp_session` signed with `JWT_SECRET`

`workers/filatelia-api/src/index.ts:1043-1211` is a complete, self-contained parallel
system: PBKDF2-SHA256 password hashing (`:1043-1061`), HMAC JWT (`:1063-1084`), and
`/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me` (`:1109-1211`).

It writes real rows into the shared D1 `User` table (`workers/filatelia-api/schema.sql:4-27`)
— the same physical database as `filatelia-web`, confirmed by identical `database_id`
in both `wrangler.toml` files. It sets `fp_session` on the Worker's own `*.workers.dev`
domain, which is why the cookie never reaches the Next app.

`filatelia-web/src/lib/auth.ts:12,33` calls this system. Its JWT payload key is `sub`,
whereas Next reads `id` — confirming E1.7.

### 3. Bearer token in localStorage — `fp_token`

Every `(admin)/admin/**` page (`DashboardClient.tsx`, `GruposAdminClient.tsx`,
`UsuariosAdminClient.tsx`, `SellosAdminClient.tsx`, `CatalogosAdminClient.tsx`,
`analitica/page.tsx`, `importar/page.tsx`) reads `localStorage.getItem('fp_token')` and
sends `Authorization: Bearer` directly to the Worker. `fp_token` is only ever populated
by `src/lib/auth.ts:20-22,41-42`. This is a third, independent identity path.

### 4. Supabase Auth — orphaned

`workers/filatelia-api/src/index.ts:34-56` (`getAuthenticatedUser`, no fallback after
E0) is used **only** by `/price-alert` (`:287`, `:302`). No route anywhere issues a
Supabase session, so it is disconnected from register and login entirely and
`/price-alert` is unreachable by real users. For the purposes of E1, Supabase is a red
herring.

## Secrets

`JWT_SECRET` (Worker) and `APP_SECRET` (Next) are different variables and have never
held the same value. `JWT_SECRET` is hardcoded in `workers/filatelia-api/wrangler.toml:7`.
`APP_SECRET` has no confirmed value in any deployed environment and currently falls back
to `'dev-secret-only-change-in-prod'`. Two sessions signed with different secrets can
never validate against each other, which is the mechanical root of the split brain.

## Options considered

### Option 1 — Next app as authority, backed by the shared D1 `User` table (RECOMMENDED)

Implement a real `/api/auth/login` (PBKDF2 verification against D1 `User`, reusing the
existing hash format) and add `/api/auth/register`, both issuing `fp_session` through
the existing `signSession`. Make `/api/auth/google` upsert into the same `User` table
instead of minting an ephemeral payload. Retire the `fp_token` / Bearer admin pattern in
favour of `fp_session` plus a role check. Delete the Worker's `/auth/*` routes.

- Pros: same-origin cookie throughout, no cross-origin cookie problem; the D1 `User`
  table and its PBKDF2 hashes already exist and are reachable through the direct binding
  after E0; zero data migration for the existing row; Google OAuth needs only an upsert,
  not a rewrite; converges on the contract `collection` and `match` already implement.
- Cons: Next takes ownership of password hashing, which duplicates Worker logic unless
  the Worker's `/auth/*` routes are deleted outright; `APP_SECRET` must become a real
  managed secret rather than a defaulted dev string.
- Effort: low to medium.

### Option 2 — Worker as authority, Next forwards Bearer tokens

- Cons: does not fix the split brain, it generalises the current admin-page workaround.
  Next middleware cannot read an httpOnly cookie set on another origin, so `/perfil` and
  `/admin` protection would have to move client-side. The Worker's CORS is
  `origin: '*'` with `credentials: 'include'`, which is invalid for cross-origin cookies
  regardless of secret alignment. `collection` and `match`, which already work, would be
  rewritten backwards.
- Effort: medium to high, and net negative.

### Option 3 — Supabase as sole identity authority

- Pros: a real identity provider with email verification, password reset and rate
  limiting, none of which the hand-rolled HMAC JWT has. Would make `/price-alert`
  meaningful.
- Cons: highest effort. Requires a new Google OAuth app inside Supabase, a D1 to
  Supabase user migration in which the existing PBKDF2 hash is **not** portable
  (forcing a password reset), and a rewrite of middleware and both working consumer
  routes — in exchange for adopting a provider that today gates nothing.
- Effort: high. Worth revisiting as a later hardening step, not as part of E1.

## Recommendation

Option 1. Not because "the session lives in Next" was assumed, but because it is the
option the codebase already partially implements and validates: `collection` and `match`
prove the contract works, and after E0 the Next app has direct D1 access with no network
hop.

Proposed scope for `sdd-propose`:

1. Real `POST /api/auth/login` with timing-safe credential verification.
2. New `POST /api/auth/register`.
3. `/api/auth/google` persists/upserts the user in D1.
4. Delete the Worker's `/auth/register|login|logout|me`.
5. Retire the `fp_token` / Bearer admin pattern in favour of `fp_session` plus role.
6. `APP_SECRET` promoted to a real managed secret.

## Findings outside E1 scope

`src/app/api/bids/route.ts:9-27` never calls `verifySession`. It derives a user id
directly from untrusted input:

```ts
userId = token.startsWith("usr_") ? token : `usr_${token.slice(0, 8)}`;
```

Sending `Authorization: Bearer usr_<victim>` impersonates that account outright on an
auction bidding endpoint; any unsigned `fp_session` cookie value is likewise accepted. A
third branch trusts `x-user-id` when `NODE_ENV === "test"`. This is a live
vulnerability, independent of E1, and is being fixed as its own work unit rather than
folded into this epic's diff.

## Open questions and risks

- Provenance of the single existing D1 `User` row is unverified. If it holds a real
  PBKDF2 hash, keeping that scheme means no migration; switching schemes forces a reset.
- `APP_SECRET` must not be allowed to fall back to the dev default in production.
- Deleting the Worker's `/auth/*` breaks any consumer still calling them. Only
  `filatelia-web/src/lib/auth.ts` does so today; confirm no mobile client or script
  depends on them before removal.
