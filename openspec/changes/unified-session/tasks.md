# Tasks: Unified Session (Epic E1)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1200–1800 (9 new/modified route+lib files, 7 admin pages + BidModal, Worker dual-accept + deletion, matching RED tests) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR4 (see work units) |
| Delivery strategy | auto-forecast (not a defined enum value — treated as forecast-driven, decision flagged) |
| Chain strategy | feature-branch-chain (recommended) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Rationale: each design stage requires a prod deploy + verification gate before the next stage may proceed (dual-accept must be live before proxy ships; proxy+clients must be live before Worker `/auth/*` deletion). Stacking to main independently would let PR4 merge before PR2/3 are verified in prod — unsafe. Maintainer must confirm `feature-branch-chain` before `sdd-apply` starts PR1.

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|----|----|----|----|
| 1 | Stage 0 seed + Next credential/OAuth auth (session exp, password.ts, login/register/logout/google) | PR1 | `cd filatelia-web && npx vitest run` | N/A — no shell/process boundary | Redeploy previous Pages build; Worker untouched |
| 2 | Worker `requireAdmin` dual-accept + Next admin proxy route | PR2 (base: PR1 branch) | `npm --prefix workers/filatelia-api test` + `cd filatelia-web && npx vitest run` | N/A | Worker dual-accept is additive/harmless to leave; redeploy previous Pages build |
| 3 | Migrate 7 admin pages + BidModal off `fp_token` | PR3 (base: PR2 branch) | `cd filatelia-web && npx vitest run` | N/A | Redeploy previous Pages build |
| 4 | Delete Worker `/auth/*`, JWT helpers, `JWT_SECRET` | PR4 (base: PR3 branch, merges last after prod verification) | `npm --prefix workers/filatelia-api test` | N/A | Redeploy previous Worker version (restore recorded `JWT_SECRET`) |

## Phase 0: Pre-Flight Verification (blocks all stages)

- [ ] 0.1 Verify prod admin `User` row hash is valid PBKDF2 (`salt:hash`, 97 chars) — non-destructive query (Req: Credential Login) — **BLOCKED: requires live production D1 access this agent does not have; must be run manually by an operator with `wrangler` prod credentials before Stage 1 ships**
- [x] 0.2 **BLOCKING**: seed `Role('admin')` + `UserRole` link for the admin user — `Role`/`UserRole` are empty; skipping this locks the owner out of `/admin` at Stage 2 (Req: Role Resolution) — delivered as `filatelia-web/db/migrations/0007_seed_admin_role.sql`, idempotent, **not executed** against remote D1 per hard constraint
- [x] 0.3 Confirm no consumer other than `lib/auth.ts` calls Worker `/auth/*` before Stage 3 (Req: Worker Auth Removal) — confirmed via repo-wide grep for `/auth/login|register|logout|me`: only `filatelia-web/src/lib/auth.ts` found

## Phase 1: Session & Password Foundations (PR1)

- [x] 1.1 RED `filatelia-web`: expired/missing-`exp` cookie rejected; missing `APP_SECRET` throws in prod (`session.test.ts`)
- [x] 1.2 GREEN: add `exp` issuance/enforcement + fail-fast secret in `src/lib/session.ts` — **product decision override applied**: 30-day sliding lifetime (not the spec's original 7-day-absolute default); `signSession` always computes fresh `iat`/`exp`, `verifySession` rejects missing/expired `exp` and missing `id`
- [x] 1.3 RED: constant-time compare accepts prod-format hash, rejects wrong password (`password.test.ts`)
- [x] 1.4 GREEN: create `src/lib/password.ts` (PBKDF2 hash/verify, Web Crypto)

## Phase 2: Credential + OAuth Routes (PR1)

- [x] 2.1 RED: login — valid creds issue session; wrong password/unknown email both 401 generic, no cookie
- [x] 2.2 GREEN: implement `POST` in `src/app/api/auth/login/route.ts`
- [x] 2.3 RED: register — new email creates row + session; duplicate email 409, no row
- [x] 2.4 GREEN: create `src/app/api/auth/register/route.ts` (open registration, no gating — product decision)
- [x] 2.5 RED: role resolves via `UserRole`/`Role` join (admin → `admin`, no rows → `collector`) — depends on 0.2
- [x] 2.6 GREEN: implement shared role-resolution query used by login/register/google — `src/lib/db/users.ts` (`resolveUserRole`, `findUserByEmail`, `createUser`, `upsertGoogleUser`)
- [x] 2.7 RED: logout clears `fp_session`
- [x] 2.8 GREEN: create `src/app/api/auth/logout/route.ts`
- [x] 2.9 RED: google upsert — returning email reuses row/role; new email inserts
- [x] 2.10 GREEN: modify `src/app/api/auth/google/route.ts` to upsert D1 `User`
- [x] 2.11 Regression: confirm `/api/collection`, `/api/match` still resolve `payload.id` unchanged — `test/session-regression.test.ts` + pre-existing `collection-api.test.ts`/`match-engine.test.ts` unmodified and still green

## Deviation note: sliding renewal implementation site (not in original design's File Changes table)

The design's File Changes table did not list `src/middleware.ts`. Implementing
"each authenticated use extends the session" required a renewal site;
`src/middleware.ts` (guards `/admin/:path*` and `/perfil`) was chosen since it
is the layer through which every protected-page request already passes. API
routes that call `verifySession` directly (`/api/collection`, `/api/match`,
`/api/bids`) do NOT renew the cookie on their own responses — this is
recorded as an explicit open decision in the spec, not a silent gap.

## Phase 3: Worker Dual-Accept (PR2)

- [ ] 3.1 Wire vitest in `workers/filatelia-api` (devDependency + script)
- [ ] 3.2 RED: `requireAdmin` accepts `X-Admin-Token`, rejects wrong/missing (constant-time)
- [ ] 3.3 GREEN: dual-accept (service token OR legacy cookie) in `index.ts` `requireAdmin`
- [ ] 3.4 Provision `ADMIN_API_TOKEN` secret (Worker + Pages)

## Phase 4: Admin Proxy + Client Migration (PR2/PR3)

- [ ] 4.1 RED: proxy 403 without `role==="admin"`; forwards with `X-Admin-Token` when authorized
- [ ] 4.2 GREEN: create `src/app/api/admin/[...path]/route.ts`
- [ ] 4.3 RED: `lib/auth.ts` no longer reads/writes `fp_token`/`fp_user`
- [ ] 4.4 GREEN: rewrite `src/lib/auth.ts` to call Next routes only
- [ ] 4.5 RED: 7 admin clients + `BidModal.tsx` contain no `fp_token`/localStorage reads
- [ ] 4.6 GREEN: migrate the 7 admin pages + `BidModal.tsx` to `fp_session`/proxy calls

## Phase 5: Worker Auth Removal (PR4, last)

- [ ] 5.1 RED: `/auth/*` returns 404 after deletion
- [ ] 5.2 GREEN: delete `/auth/register|login|logout|me`, JWT helpers, `hashPassword`/`verifyPassword`; `requireAdmin` becomes token-only; remove `JWT_SECRET` from `wrangler.toml`
- [ ] 5.3 Full regression: `filatelia-web` vitest, `workers/filatelia-api` vitest, root `node --test test/*.test.mjs`

Open product questions — RESOLVED during PR1 apply: session lifetime is 30 days
with sliding renewal (see spec.md / design.md Open Decisions); registration is
open, no gating. See the deviation note above Phase 3 for the sliding-renewal
implementation site.
