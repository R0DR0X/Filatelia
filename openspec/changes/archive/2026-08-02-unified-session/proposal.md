# Proposal: Unified Session (Epic E1)

## Intent

A collector who registers by email today cannot use the site: the Worker's `/auth/*` writes a real D1 `User` row but sets its cookie on `*.workers.dev`, signed with `JWT_SECRET`, which Next (signing with `APP_SECRET`) can never validate. Three live identity paths (Next `fp_session`, Worker `fp_session`, `fp_token` localStorage) plus orphaned Supabase must collapse into one authority.

## Decision

**Next app is the identity authority**, backed by the shared D1 `User` table via the direct binding (post-E0).

- Rejected — Worker as authority: cross-origin httpOnly cookies cannot reach Next middleware; Worker CORS (`origin: '*'` + credentials) is invalid for them; it would rewrite the two routes (`/api/collection`, `/api/match`) that already work.
- Rejected — Supabase: highest effort, PBKDF2 hashes are not portable (forced resets), new OAuth app, rewrites working consumers; today it gates nothing. Revisit later as hardening.

## Scope

### In Scope
1. Real `POST /api/auth/login`: timing-safe PBKDF2 verification against D1 `User`, reusing the existing hash format.
2. New `POST /api/auth/register`.
3. `/api/auth/google` upserts into D1 `User` (match by email so the existing admin row keeps `role: admin`; today every Google login mints an ephemeral `collector`).
4. Delete Worker `/auth/register|login|logout|me`.
5. Replace `fp_token`/Bearer in the seven admin pages with `fp_session` + role check.
6. `APP_SECRET` becomes a required managed secret (no dev fallback in production). `JWT_SECRET` is committed in `wrangler.toml` — treat as compromised, remove.
7. Session expiry: add `exp` issuance and enforcement in `verifySession`. **Included** because we are rewriting session issuance in the same file; shipping a new auth system with immortal tokens would immediately create the next security epic.

### Out of Scope (non-goals)
- `/api/bids` impersonation — already fixed (08e3fe4).
- Supabase removal/adoption; `/price-alert` remains unreachable.
- Password reset, email verification, rate limiting (later hardening).
- Any Worker endpoint other than `/auth/*`.

## Capabilities

### New Capabilities
- `user-auth`: registration, email/password login, Google OAuth upsert, unified `fp_session` issuance/verification with expiry, role-gated admin access.

### Modified Capabilities
- None (no existing specs).

## Migration

Production D1 holds exactly one `User` row (admin, rodrigopianto2005@gmail.com). It is preserved as-is; email match links Google login to it. Verify its hash is valid PBKDF2 before relying on password login for it. Cookie holders: all current sessions invalidate when `APP_SECRET` is set — users re-login (acceptable: effectively one real user).

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `filatelia-web/src/lib/session.ts` | Modified | `exp` claim, secret hardening |
| `filatelia-web/src/app/api/auth/{login,register,google}` | Modified/New | real auth against D1 |
| `filatelia-web/src/lib/auth.ts` | Removed/Rewritten | stops calling Worker auth |
| `filatelia-web/src/app/(admin)/admin/**` (7 pages) | Modified | `fp_session` replaces `fp_token` |
| `workers/filatelia-api/src/index.ts:1043-1211` | Removed | Worker auth system deleted |
| `workers/filatelia-api/wrangler.toml` | Modified | drop committed `JWT_SECRET` |

## Test Surfaces

- `filatelia-web` vitest: affected (auth routes, session lib, admin clients).
- `workers/filatelia-api` vitest: affected (delete `/auth/*` tests).
- Root `node:test`: verify whether it covers Worker auth; likely unaffected — confirm before apply.
- Scrapers (python): unaffected.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bad deploy locks everyone out of auth | Med | Staged rollout (below); Google OAuth path kept working before Worker deletion |
| `sub` vs `id` payload mismatch resurfaces | Med | Single payload contract (`id`) defined in spec; delete Worker JWT code |
| Admin pages lose access mid-migration | Med | Ship Next-side session auth for admin pages in the same slice as Bearer removal; do not delete Worker auth before admin pages are migrated |
| Google OAuth continuity breaks on upsert | Low | Upsert by email, fall back to insert; existing admin row verified first |
| `APP_SECRET` misconfigured in prod | Med | Fail-fast on missing secret (mirrors E0 binding behavior) |

## Rollback Plan

Order deployments so each step is independently revertible:
1. Ship Next auth (login/register/google-upsert/expiry) first; Worker `/auth/*` still exists → revert = redeploy previous Pages build.
2. Migrate admin pages; Worker auth still exists → same revert.
3. Delete Worker `/auth/*` last, only after prod verification → revert = redeploy previous Worker version.
Secrets: keep the previous `APP_SECRET` value recorded until step 3 completes; rotating back restores old cookies' validity.

## Dependencies

- Epic E0 (landed): direct D1 binding in `filatelia-web`, fail-fast on missing binding.
- `APP_SECRET` provisioned in Pages production environment before step 1 deploys.

## Success Criteria

- [ ] Email registration → login → `/api/collection` works end-to-end on production domain.
- [ ] Returning Google user gets the same D1 `User` row and role every login.
- [ ] All seven admin pages function with no `fp_token` reads remaining.
- [ ] Sessions expire; expired cookies are rejected.
- [ ] Worker `/auth/*` returns 404; no `JWT_SECRET` in the repo.

## Open Questions (flagged, not answered)

1. Hash provenance of the single admin `User` row — is it a valid PBKDF2 hash usable for password login?
2. Session lifetime value (e.g. 7 vs 30 days) and whether sliding renewal is wanted.
3. Any external consumer (mobile client, script, cron) of Worker `/auth/*` besides `filatelia-web/src/lib/auth.ts`?
4. Should registration be open to the public immediately, or gated while the catalog is incomplete?

## Proposal question round

Execution mode is auto, so these product questions await user review rather than blocking:
- Q2 and Q4 above are product decisions (session lifetime; open vs gated registration).
- Assumption made: invalidating all current cookies is acceptable because production has one real user. Correct if wrong.
- Assumption made: session expiry belongs in this slice. Say so if you prefer it deferred.
