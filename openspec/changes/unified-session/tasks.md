# Tasks: Unified Session (Epic E1)

## Checkbox Legend

- `[x]` — done: the artifact was authored AND the operational action it describes was actually performed/verified.
- `[~]` — artifact authored, operational action NOT performed: e.g. a migration file was written but never executed against remote D1, or a secret's rollout steps were documented but the secret was never provisioned. Do not read `[~]` as "done".
- `[ ]` — not started.

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
- [~] 0.2 **BLOCKING, NOT YET EXECUTED**: seed `Role('admin')` + `UserRole` link for the admin user — `Role`/`UserRole` are empty; skipping this locks the owner out of `/admin` at Stage 2 (Req: Role Resolution) — migration authored as `filatelia-web/db/migrations/0007_seed_admin_role.sql`, idempotent, **not executed** against remote D1 per hard constraint. An operator with `wrangler`/D1 prod credentials must run it before Stage 2 ships (see the Deployment Runbook step 2 below).
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

- [x] 3.1 Wire vitest in `workers/filatelia-api` (devDependency + script) — already done in commit `8409aca`; verified `package.json`'s `test` script and `vitest.config.mts` exist and run
- [x] 3.2 RED: `requireAdmin` accepts `X-Admin-Token`, rejects wrong/missing (constant-time) — `workers/filatelia-api/test/admin-token.test.ts`
- [x] 3.3 GREEN: dual-accept (service token OR legacy cookie) in `index.ts` `requireAdmin` — added `timingSafeEqual` + service-token branch, existing cookie/first-user/`@filateliaperuana.com` rules left unchanged
- [~] 3.4 **NOT YET PROVISIONED**: Provision `ADMIN_API_TOKEN` secret (Worker + Pages) — rollout steps documented below, but the token itself has NOT been generated or set anywhere. **Operator action required, not executable by this agent (no wrangler/deploy access)**:
  1. Generate a long random secret, e.g. `openssl rand -hex 32`.
  2. Worker: `wrangler secret put ADMIN_API_TOKEN --config workers/filatelia-api/wrangler.toml` (paste the generated value). Do NOT add it to `wrangler.toml` as a `[vars]` entry — that would commit it to git (unlike the legacy `JWT_SECRET`, which is already flagged for removal in Phase 5, this one starts out correctly as a secret).
  3. Pages (`filatelia-web`): set `ADMIN_API_TOKEN` as an encrypted environment variable in the Cloudflare Pages project settings (Production and Preview), same value as step 2.
  4. Local dev: add `ADMIN_API_TOKEN=<same value>` to `filatelia-web/.env` (see `.env.example`, not committed) and to the Worker's local `.dev.vars` if/when one exists.
  5. Verify with a manual authenticated request to a Worker `/admin/*` route bearing `X-Admin-Token` before relying on the proxy in prod.

## Phase 4: Admin Proxy + Client Migration (PR2/PR3)

- [x] 4.1 RED: proxy 403 without `role==="admin"`; forwards with `X-Admin-Token` when authorized — `filatelia-web/test/admin-proxy-api.test.ts`
- [x] 4.2 GREEN: create `src/app/api/admin/[...path]/route.ts`
- [x] 4.3 RED: `lib/auth.ts` no longer reads/writes `fp_token`/`fp_user` — `filatelia-web/test/auth-lib.test.ts` (source-scan for `localStorage`/`workers.dev`, functional tests asserting calls to `/api/auth/*`)
- [x] 4.4 GREEN: rewrite `src/lib/auth.ts` to call Next routes only — `login`/`register`/`logout`/`getMe` now call `/api/auth/login|register|logout|me` with `credentials: "same-origin"`; no `localStorage`/Worker reference remains
- [x] 4.5 RED: 7 admin clients + `BidModal.tsx` contain no `fp_token`/localStorage reads — `filatelia-web/test/admin-clients-migration.test.ts` (source-scan across all 8 files) + `filatelia-web/test/admin-api-client.test.ts` (behavioral test for the shared `adminFetch` call shape)
- [x] 4.6 GREEN: migrate the 7 admin pages + `BidModal.tsx` to `fp_session`/proxy calls — see deviation notes below

## Deviation note: `GET /api/auth/me` was created, not dropped

The design's File Changes table implied `lib/auth.ts` could simply stop
calling Worker `/auth/*` without a replacement for `/auth/me`. In practice
`getMe()` is a load-bearing export with 2 consumers (`PerfilClient.tsx`,
and now `Navbar.tsx` — see the `getCachedUser` note below), so a same-origin
equivalent had to exist first. Created `filatelia-web/src/app/api/auth/me/route.ts`:
verifies `fp_session`, re-reads the row from D1 by id (`findUserById`, added
to `src/lib/db/users.ts`) rather than trusting the token's baked-in claims,
and returns `{success:true, user:{id,name,email,role}}` or 401.

## Deviation note: `getCachedUser()` removed, not kept as a stub

`getCachedUser()` was a synchronous, localStorage-backed read. Since
`fp_session` is httpOnly, there is no synchronous, storage-free way to serve
the same contract — so it was deleted rather than kept under the same name
backed by something else. Its only caller, `Navbar.tsx`, now calls the
already-async `getMe()` in a `useEffect`, the same pattern `PerfilClient.tsx`
already used.

## Deviation note: shared `adminFetch` helper introduced

All 7 admin clients shared one call shape (same-origin `/api/admin/<subpath>`,
`credentials: "same-origin"`, no `Authorization` header). Rather than
duplicate that shape 7 times, `filatelia-web/src/lib/adminApi.ts` exports
`adminFetch(subpath, init)`. This also gave the migration a testable seam:
the repo has no DOM/component-rendering test setup (no jsdom/testing-library
dependency), so the 7 `.tsx` admin clients themselves cannot be rendered and
exercised in `vitest run` (environment: `node`). `adminFetch` is unit-tested
directly (`test/admin-api-client.test.ts`); the clients are covered by a
source-scan test confirming they call it and hold no `fp_token`/localStorage
reference (`test/admin-clients-migration.test.ts`).

## Deviation note: `BidModal.tsx` does not go through the admin proxy

`BidModal.tsx` is not an admin surface — it POSTs to `/api/bids`, which
already (commit `08e3fe4`) derives the bidder solely from the verified
`fp_session` cookie and ignores caller-supplied `Authorization`/`X-User-Name`
headers entirely. Its old `fp_token`/`fp_user` reads and both headers were
therefore already dead weight before this change; they are now removed and
the fetch call carries `credentials: "same-origin"` explicitly instead.

## Closed gap: `/analytics/stats` and `/import-stamp` are now reachable through the admin proxy (Worker-side addendum, applied)

The gap originally noted here (both calls 404ing through the proxy) has been
closed with a Worker-side addendum in `workers/filatelia-api/src/index.ts`.
While investigating it, `POST /import-stamp` was found to have **no
authentication at all** — anyone on the internet could bulk-insert/update
rows in the production D1 `Stamp` table. That is now fixed as part of the
same change:

- `POST /import-stamp` is guarded by the existing `requireAdmin` (403 when
  unauthorized), exactly like the `/admin/*` routes. The handler body was
  extracted into a shared `importStampHandler` function registered on both
  `/import-stamp` (used by the scrapers) and the new `/admin/import-stamp`
  (reachable through the Next admin proxy), so the two routes cannot drift.
- `GET /analytics/stats` had its hand-rolled inline admin check (duplicated
  role/email/first-user logic) replaced with `requireAdmin`, so there is one
  admin authority in the file. Its handler was likewise extracted into
  `analyticsStatsHandler` and registered on both `/analytics/stats` and the
  new `/admin/analytics/stats`.
- The three scrapers (`01-wikidata-scraper.mjs`, `02-wns-scraper.mjs`,
  `03-colnect-scraper.mjs`) now send `X-Admin-Token: process.env.ADMIN_API_TOKEN`
  on every `/import-stamp` POST (shared helper: `scrapers/lib/admin-token.mjs`),
  and fail fast at startup with a clear message if the variable is unset,
  instead of discovering every write 403s after a full unattended crawl.
- `scrapers/README.md` no longer describes `/import-stamp` as an
  unauthenticated "secure endpoint"; it documents the `ADMIN_API_TOKEN`
  requirement and how to set it for a local/VPS scraper run.
- Regression tests: `workers/filatelia-api/test/import-stamp-admin.test.ts`
  (403 with no credentials on both `/import-stamp` and `/admin/import-stamp`;
  not-403 with a correct `X-Admin-Token`; same for `/admin/analytics/stats`).

Both migrated admin-UI call sites (`analitica/page.tsx`, `DashboardClient.tsx`
→ `adminFetch("analytics/stats")`; `importar/page.tsx` →
`adminFetch("import-stamp")`) now resolve through the proxy instead of 404ing.

## Phase 5: Worker Auth Removal (PR4, last)

- [x] 5.1 RED: `/auth/*` returns 404 after deletion — `workers/filatelia-api/test/auth-removal.test.ts`; also RED (pre-deletion) two regression tests proving a forged `@filateliaperuana.com` cookie and a forged cookie against a single-row `User` table both currently grant admin via `requireAdmin`
- [x] 5.2 GREEN: deleted `/auth/register|login|logout|me` and the now-dead helpers `hashPassword`, `verifyPassword`, `createJWT`, `verifyJWT`, `getAuthUser`, `setSessionCookie`, `clearSessionCookie` (all confirmed dead via grep before removal — see deviation note below); `requireAdmin` is now token-only (`X-Admin-Token` constant-time compare against `ADMIN_API_TOKEN`, nothing else — the legacy cookie path, the `@filateliaperuana.com` email rule, and the "sole `User` row is admin" rule are gone); removed `JWT_SECRET` from `wrangler.toml` and from the `Bindings` type in `src/index.ts` (that type is where the Worker declares its env — this repo has no separate `src/types.ts` `Env` export); added `ADMIN_API_TOKEN` to that same `Bindings` type (was previously read via `c.env.ADMIN_API_TOKEN` without a declared type)
- [x] 5.3 Full regression, corrected after the independent verification pass closed 4 gaps (tampered-cookie and rotated-secret tests, middleware admin-role-gate test, 3 new tsc errors introduced by PR1, and this checklist's own misreported status): `filatelia-web` vitest — 129 passed / 1 pre-existing failure needing live D1 (`test/collection-api.test.ts`, unchanged baseline) — 130 total, up from 125 (four new coverage tests: tampered-cookie + rotated-secret in `session.test.ts`, admin-allow + admin-deny role-gate in `middleware.test.ts`); `workers/filatelia-api` vitest 35/35; root `node --test test/*.test.mjs` 43/43; `filatelia-web` `npx tsc --noEmit` — verified baseline (commit 3c61c9d) was exactly 3 pre-existing errors (`prisma.config.ts(2,35)`, `src/lib/session.ts` `Uint8Array`/`ArrayBuffer` pair), not 6 as originally recorded here; PR1 had also introduced 3 NEW errors (`src/lib/password.ts(33,40)`, `test/session.test.ts(73,17)`/`(78,19)`) that were previously misreported as pre-existing. All 3 new errors are now fixed, and the fix for `password.ts`'s `Uint8Array<ArrayBuffer>`/`BufferSource` mismatch applied cleanly to the 2 pre-existing `session.ts` errors of the same class, so those are fixed too (scope change, called out explicitly). Final tsc state: 1 error (`prisma.config.ts(2,35)`, unrelated `prisma/config` module resolution, out of scope for this change).

### Deviation note: `JWT_SECRET` lived in the `Bindings` type in `src/index.ts`, not in a separate `src/types.ts` `Env`

The design/task text referred to "the `Env` type in `src/types.ts`". This
Worker has no such type — `src/types.ts` only exports `QueryRequest`,
`MatchResult`, `QueryResponse` (request/response DTOs). The actual Cloudflare
bindings type is `Bindings` in `src/index.ts:5-16`, used as `Hono<{
Bindings: Bindings }>`. `JWT_SECRET` was removed from there instead, and
`ADMIN_API_TOKEN` was added to the same place (it was already read via
`c.env.ADMIN_API_TOKEN` in `requireAdmin` but had never been declared in the
type — TypeScript widened `c` to `any` there so it type-checked anyway;
declaring it now documents the real contract).

### Deviation note: dead-code confirmation via grep before deletion

Before deleting each helper, `grep -rn` across `src/` and `test/` confirmed
zero remaining callers once the four `/auth/*` routes were gone:

- `hashPassword` — only caller was `/auth/register`.
- `verifyPassword` — only caller was `/auth/login`.
- `createJWT` — only callers were `/auth/register` and `/auth/login`.
- `verifyJWT` — only caller was `getAuthUser`.
- `getAuthUser` — exactly two callers, as the orchestrator's pre-flight
  mapping predicted: `/auth/me` (deleted) and `requireAdmin`'s legacy cookie
  branch (deleted). No other caller existed anywhere in `src/` or `test/`.
- `setSessionCookie` / `clearSessionCookie` — only callers were the deleted
  `/auth/register|login|logout` routes.

Nothing was found to still have a live caller; no helper was kept.

### CRITICAL — Deployment Runbook (read before deploying this Worker)

Deploying the changes in this PR makes `requireAdmin` **token-only**: the
legacy cookie-based admin paths (including the two privilege-escalation
rules) no longer exist. The *only* remaining path to any `/admin/*` Worker
route is: browser → Next proxy (`filatelia-web/src/app/api/admin/[...path]/route.ts`)
→ verifies `fp_session` has `role === "admin"` → forwards to the Worker with
`X-Admin-Token`. That `role` claim is resolved from the `Role`/`UserRole`
join at session-issuance time.

**If this Worker is deployed before the preconditions below are satisfied,
the site owner is locked out of `/admin` with no recovery path through the
UI**, because there will be no way to obtain an `fp_session` whose `role` is
`"admin"`, and the Worker will reject everything that isn't a valid
`X-Admin-Token`.

Required order:

1. **Confirm PR1–PR3 are already live and verified in prod.** This PR
   (`requireAdmin` token-only) must be the LAST deploy in the chain — do not
   deploy it standalone or out of order. Verify:
   - Next app (`filatelia-web`) is serving `/api/auth/login|register|logout|google`
     and `/api/admin/[...path]` from the branches shipped in PR1–PR3.
   - `APP_SECRET` is set in the Next/Pages environment (prod + preview).
2. **Run migration `filatelia-web/db/migrations/0007_seed_admin_role.sql`
   against remote D1** — this is currently NOT executed (task 0.2 delivered
   the migration but explicitly did not run it, per this agent's hard
   constraint against touching prod D1). It is idempotent and safe to run
   more than once. An operator with `wrangler`/D1 prod credentials must run
   it. Verify afterward with a read-only query that the admin `User` row has
   a `UserRole` row joined to `Role('admin')`.
3. **Run migration `filatelia-web/db/migrations/0008_create_site_visit.sql`
   against remote D1 — BEFORE this Worker build is deployed.** This Worker
   build removes the `CREATE TABLE IF NOT EXISTS SiteVisit` that the old
   `POST /analytics/visit` handler ran on every request, so from this deploy
   onwards the endpoint assumes the table already exists. The migration is
   idempotent (`CREATE TABLE IF NOT EXISTS`) and safe to run more than once.
   Like 0007 it has NOT been executed by this agent, per the hard constraint
   against touching prod D1.
   - **Belief, UNVERIFIED against live D1**: production is expected to
     *already* have `SiteVisit`, because the old handler created it on demand
     on the first anonymous pageview. Nobody has confirmed this against the
     real database — treat it as an assumption, not a fact, and check it.
   - **Read-only check an operator can run** (no writes, no DDL):
     `wrangler d1 execute filatelia-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='SiteVisit';"`
     — one row means the table exists; zero rows means it does not and the
     migration is mandatory before step 5.
   - **Symptom if this is wrong**: silent, total analytics loss. Every
     `POST /analytics/visit` answers 500 with `no such table: SiteVisit`, and
     `filatelia-web/src/components/AnalyticsTracker.tsx` swallows it with
     `.catch(() => {})` — so there is NO user-facing error, no broken page,
     and no client-side signal at all; visit counts simply stop growing. The
     only evidence is the Worker log line
     `analytics/visit: rejected — the SiteVisit table does not exist …`,
     which this build emits for exactly this case. Check Worker logs after
     deploy if the count on the site stops moving.
4. **Provision `ADMIN_API_TOKEN`** on both sides (see task 3.4 for the exact
   steps): `wrangler secret put ADMIN_API_TOKEN` on the Worker, and the same
   value as an encrypted Pages environment variable for `filatelia-web`.
   Verify with a manual authenticated request to a Worker `/admin/*` route
   bearing `X-Admin-Token` BEFORE deploying this PR's `requireAdmin` change.
5. **Only once 1–4 are verified, deploy this PR's Worker build**
   (`requireAdmin` token-only, `/auth/*` gone, `JWT_SECRET` gone).
6. **Post-deploy smoke test**: log in as the admin user through the Next app
   UI, confirm `/admin` loads and at least one admin action (e.g. `GET
   /admin/stamps` through the proxy) succeeds.
7. **Rotate/remove `JWT_SECRET` from the deployed Worker.** It was committed
   in plaintext in `wrangler.toml` (value
   `fp-secret-2024-filatelia-peruana-secure`) for the lifetime of this
   repository and MUST be treated as compromised — anyone with repo access
   could forge a legacy `fp_session` cookie with it (this is exactly what
   this PR's regression tests demonstrate). Since this PR removes it from
   the `Bindings` type and the code path that read it, no code change is
   needed to stop using it — but if a previous Worker deploy still has it as
   a live `[vars]` value or Worker secret, an operator must explicitly clear
   it (`wrangler secret delete JWT_SECRET` if it was ever set as a secret,
   or redeploy from this branch so the `[vars]` entry is gone). This is a
   required operator action, not something this agent can perform (no
   `wrangler`/deploy access).

### Recovery if deployed out of order (steps 2–4 skipped before step 5)

Symptom: the Worker's `/admin/*` routes reject everything without a matching
`X-Admin-Token`, and there is no cookie fallback to recover through, so
`/admin` is unusable.

**Do NOT roll the Worker back as a stopgap.** Rolling back to the PR2/PR3
build is *not* a neutral undo — it re-opens the exact vulnerability this PR
closes:

- Worker `[vars]` are bundled per deployment, not resolved from a separate
  secret store. Redeploying the old build therefore redeploys
  `JWT_SECRET = "fp-secret-2024-filatelia-peruana-secure"` as a plaintext
  `[vars]` entry, restoring a secret that has been readable by anyone with
  repository access for the lifetime of this repo (see step 7).
- That old build also restores the legacy `fp_session` cookie path that
  *trusts* that secret, plus the two privilege-escalation rules it carried
  (`@filateliaperuana.com` email suffix ⇒ admin, and "if `User` has exactly
  one row, that row is admin"). Anyone holding the compromised secret can
  forge an admin session — this is precisely the admin-takeover path the
  regression tests in `workers/filatelia-api/test/auth-removal.test.ts`
  exist to prove closed.

A rollback is permissible ONLY if, *before* the old build goes live, either
(i) `JWT_SECRET` has been rotated to a fresh value not present in any commit
and the old build is redeployed with that new value, or (ii) the legacy
cookie path is provably unreachable (e.g. the Worker is not publicly
routable). If neither holds, do not roll back — use the break-glass below,
which does not depend on the compromised secret at all.

**Break-glass (preferred, no rollback, no compromised secret).** The
operator already has `wrangler` access to D1 and to Worker secrets, which is
everything this needs. In order:

1. **Provision `ADMIN_API_TOKEN` on the Worker.** Generate a fresh random
   value (e.g. `openssl rand -hex 32`) and run
   `wrangler secret put ADMIN_API_TOKEN` against the Worker. This takes
   effect without redeploying, so the current (safe) build stays live.
2. **Set the same value as an encrypted Pages environment variable** named
   `ADMIN_API_TOKEN` for `filatelia-web` (prod, and preview if used), then
   redeploy/restart the Pages project so it picks the value up. The two
   values must match exactly — a skew produces a 403 on every admin action
   that is byte-identical to a legitimate denial (see the server-side logs
   added for this: `requireAdmin: rejected — …` in the Worker and
   `[admin-proxy] …` in the Next route).
3. **Verify the Worker hop in isolation**, before involving the browser:
   `curl -s -o /dev/null -w '%{http_code}' -H "X-Admin-Token: <value>" \
   https://<worker-host>/admin/stamps` — expect a non-403 status. A 403 here
   means step 1/2 disagree; fix that before continuing.
4. **Run migration `filatelia-web/db/migrations/0007_seed_admin_role.sql`
   against remote D1** (`wrangler d1 execute <db> --remote --file=…`). It is
   idempotent. This is what makes the admin's `fp_session` carry
   `role: "admin"`, which is what the Next proxy gates on. Note the Worker
   itself does not need `Role`/`UserRole` to exist — only the proxy does, to
   decide whether to forward at all.
5. **Verify the grant read-only**: confirm the admin `User` row now has a
   `UserRole` row joined to `Role('admin')`.
6. **Re-log-in through the Next app UI** so a fresh session cookie is issued
   carrying the new role claim, then re-run step 6 of the deploy order
   (`/admin` loads, one admin action succeeds).

Steps 1–3 alone restore the Worker hop; steps 4–6 restore the operator's own
admin session. Neither touches `JWT_SECRET`, and neither requires reopening
the legacy cookie path. Whatever the recovery route, step 7 of the deploy
order (rotate/remove `JWT_SECRET` from every deployed Worker version) remains
mandatory and is not satisfied by any of the above.

Open product questions — RESOLVED during PR1 apply: session lifetime is 30 days
with sliding renewal (see spec.md / design.md Open Decisions); registration is
open, no gating. See the deviation note above Phase 3 for the sliding-renewal
implementation site.
