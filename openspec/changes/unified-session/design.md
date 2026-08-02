# Design: Unified Session (Epic E1)

## Technical Approach

The Next app (Cloudflare Pages, edge runtime, Web Crypto only) becomes the single identity authority. `filatelia-web/src/lib/session.ts` is extended with `exp` issuance/enforcement and a fail-fast secret; `/api/auth/login|register` implement real PBKDF2 credential auth against D1 via the direct `process.env.DB` binding; `/api/auth/google` upserts into D1 `User`. Admin pages stop talking to the Worker directly: a Next proxy route authorizes with `fp_session` and forwards server-to-server with a service token. Worker `/auth/*` and `JWT_SECRET` are deleted last.

**Critical dependency the proposal missed**: Worker `requireAdmin` (`workers/filatelia-api/src/index.ts:1404`) authenticates via `getAuthUser`, which verifies the `fp_session` cookie with `JWT_SECRET`. Deleting `JWT_SECRET` breaks every Worker `/admin/*` endpoint unless `requireAdmin` is migrated to the service token first.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Role claim | Resolve at issuance via `LEFT JOIN UserRole/Role`; denormalize `role` into payload. No role row → `"collector"`, NEVER admin | Per-request join (extra D1 read on every middleware hit — middleware cannot query D1 anyway); no claim (breaks `src/middleware.ts:24`); `role` column on `User` (schema change for one consumer) | Middleware already gates `/admin` on `payload.role`; claim is load-bearing. **Verified live: `Role` and `UserRole` are both EMPTY (0 rows)** — role resolution ships blind unless Stage 0 seeds them first (see Migration) |
| Password scheme | Keep PBKDF2-SHA256, 100k iterations, `saltHex:hashHex` (matches the verified prod row: 97 chars, `:` at 33) | bcrypt/scrypt (forces reset of the only real user); Node crypto (unavailable on edge) | Zero password migration; Web Crypto native |
| Password compare | Constant-time XOR-accumulate over decoded byte arrays after length check | Port Worker `verifyPassword` (`index.ts:1061` uses `===` — timing leak, forbidden) | Timing-safe under Web Crypto (no `timingSafeEqual` on edge) |
| Payload contract | `{ id, email, name, role, picture?, iat, exp }` — canonical key `id` | Keep Worker's `sub` (would require rewriting `/api/collection`, `/api/match`, middleware — the routes that already work) | `sub` dies with the Worker JWT code; `verifySession` rejects payloads missing `id` or `exp` |
| Secret | `APP_SECRET` required; module throws in production if unset (mirrors E0 fail-fast). No dual-secret window | Dual-secret verify during rotation (complexity for one real user) | Old/dev-fallback cookies become invalid → clean re-login |
| Admin transport | Next proxy `/api/admin/[...path]`: verify `fp_session` + `role==="admin"`, forward to Worker with `X-Admin-Token` (secret, constant-time compare in Worker) | Rewrite admin CRUD in Next (Worker endpoints touch R2/import — too large); new Bearer token in localStorage (keeps XSS-readable credential) | Minimal diff; httpOnly cookie never leaves origin; Worker endpoints unchanged internally |
| Session lifetime | 30 days, SLIDING renewal — `src/middleware.ts` reissues `fp_session` with a fresh `iat`/`exp` on every authenticated request to a protected page | 7 days absolute, no renewal (original safe default) | Product decision made during apply (overrides the original default): an active user should not be logged out for mere inactivity inside the 30-day window. NOTE: this is bounded by the absolute cap below — it is not "never logged out" |
| Absolute session cap | 90 days, enforced on the preserved `origIat` claim: `verifySession` rejects a token older than `ABSOLUTE_SESSION_TTL_SECONDS` regardless of how fresh `exp` is | Unbounded sliding renewal (the E1 behavior); shorter caps (interrupt a genuinely active user) | Decision made LATER than the row above, during E3, and it deliberately narrows it: unbounded renewal meant a session — and the `role` claim baked into it — could live forever, so a stolen cookie or a revoked admin kept working as long as it was used once every 30 days. The cap is what makes revocation eventually total even if every other layer fails. Net contract: 30-day sliding window inside a 90-day ceiling |

## Sequence Diagrams

Credential login:

    Browser          Next /api/auth/login          D1 (binding)
      │ POST {email,password}  │                        │
      │───────────────────────►│  SELECT User LEFT JOIN │
      │                        │  UserRole/Role by email│
      │                        │───────────────────────►│
      │                        │◄──── row + role ───────│
      │                        │ PBKDF2(pw, salt) ──┐   │
      │                        │ const-time compare◄┘   │
      │◄─ Set-Cookie fp_session│ signSession({id,role,  │
      │   (httpOnly, 7d)       │  ...,iat,exp})         │

Google OAuth with upsert:

    Browser      Google      Next /api/auth/google       D1
      │ redirect ──►│              │                      │
      │◄── code ────│              │                      │
      │ callback ──────────────────►│ exchange + profile  │
      │                            │ SELECT User by email │
      │                            │─────────────────────►│
      │                            │ hit: reuse id + role │
      │                            │ miss: INSERT User    │
      │                            │  (no role row →      │
      │                            │   role "collector")  │
      │◄─ Set-Cookie fp_session ───│ signSession(payload) │

## File Changes

| File | Action | Description |
|---|---|---|
| `filatelia-web/src/lib/session.ts` | Modify | `exp` issue+enforce, reject missing `id`, prod fail-fast on `APP_SECRET` |
| `filatelia-web/src/lib/password.ts` | Create | PBKDF2 hash/verify, constant-time compare (Web Crypto) |
| `filatelia-web/src/app/api/auth/login/route.ts` | Modify | Replace 501 POST with real credential login |
| `filatelia-web/src/app/api/auth/register/route.ts` | Create | Insert User, issue session |
| `filatelia-web/src/app/api/auth/logout/route.ts` | Create | Clear `fp_session` (replaces Worker logout) |
| `filatelia-web/src/app/api/auth/google/route.ts` | Modify | D1 upsert by email before signing |
| `filatelia-web/src/app/api/admin/[...path]/route.ts` | Create | Session-gated proxy → Worker with `X-Admin-Token` |
| `filatelia-web/src/lib/auth.ts` | Rewrite | Call Next routes; delete all localStorage (`fp_token`, `fp_user`) |
| `(admin)/admin/**` 7 clients + `components/auctions/BidModal.tsx` | Modify | Drop `fp_token` reads; call proxy / cookie-auth routes |
| `workers/filatelia-api/src/index.ts` | Modify | `requireAdmin` → `X-Admin-Token` (dual-accept, then only); delete `/auth/*`, JWT helpers, `hashPassword`/`verifyPassword` |
| `workers/filatelia-api/wrangler.toml` | Modify | Remove committed `JWT_SECRET` |

## Testing Strategy (Strict TDD)

| Surface | Affected | Approach |
|---|---|---|
| filatelia-web vitest | Yes (primary) | RED first: expired/missing-`exp` token rejected; missing `APP_SECRET` throws in prod; timing-safe verify accepts prod-format hash, rejects wrong pw; login/register/google-upsert with mocked D1; proxy 403 without admin role; `fp_token` absent from clients |
| workers/filatelia-api vitest | Yes — currently UNWIRED | Wire vitest (devDependency + script) in stage 2; RED tests: `requireAdmin` accepts `X-Admin-Token`, rejects wrong/missing token constant-time; `/auth/*` returns 404 after deletion |
| Root node:test | Confirm-only | No auth coverage expected; verify before apply |
| Scrapers python | No | — |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Web route/middleware changes are covered by the auth test plan above.

## Migration / Rollout

Precondition: verify prod admin row has a `Role('admin')`+`UserRole` link; seed one if absent (middleware needs `role:"admin"`).

| Stage | Deploy | Rollback |
|---|---|---|
| 1 | Set `APP_SECRET` + `ADMIN_API_TOKEN` (Pages) and `ADMIN_API_TOKEN` (Worker secret). Ship Next auth (login/register/google-upsert/logout/expiry). Worker untouched | Redeploy previous Pages build. Record old `APP_SECRET` state until stage 3 |
| 2 | Worker first: `requireAdmin` dual-accepts service token OR legacy cookie (additive — no admin lockout window). Then Pages: proxy route + 7 admin clients + BidModal + `lib/auth.ts` rewrite | Redeploy previous Pages build; Worker dual-accept is harmless to leave |
| 3 | After prod verification: delete Worker `/auth/*` + legacy cookie path + `JWT_SECRET`. `requireAdmin` = service token only | Redeploy previous Worker version (restores `JWT_SECRET` from recorded value) |

Ordering guarantee: nothing is deleted while a client depends on it — `lib/auth.ts` stops calling Worker `/auth/*` in stage 2; deletion is stage 3.

## Silent-Breakage Watchlist

- Existing browser cookies invalidate at stage 1 (secret + `exp` enforcement) → redirect to login; acceptable (one real user).
- `payload.sub` vs `id`: any leftover reader of `sub` gets `undefined`; grep-gate in verify.
- `fp_user` localStorage cache (`getCachedUser`) consumers must migrate to `GET /api/auth/login` (me) or they render stale identity.
- `BidModal.tsx:51` reads `fp_token` — outside the seven admin pages, easy to miss.
- Middleware matcher covers only `/admin/:path*` and `/perfil`; API routes must keep their own `verifySession` calls — no regression allowed in `/api/collection`, `/api/match` (payload key `id` preserved).
- Worker `/admin/*` guard breaks if stage 3 lands before stage 2's dual-accept (enforced by ordering).

## Open Questions

- [x] Session lifetime 7 vs 30 days; sliding renewal wanted? DECIDED during apply: 30 days, sliding renewal at `src/middleware.ts`. Later NARROWED in E3: renewal is capped by a 90-day absolute ceiling (`origIat`), so even a continuously active session must re-authenticate eventually.
- [x] Registration open vs gated at launch? DECIDED during apply: open, no gating.
- [x] Any external consumer of Worker `/auth/*` besides `lib/auth.ts`? Confirmed during apply via repo-wide grep for `/auth/login|register|logout|me`: only `filatelia-web/src/lib/auth.ts` calls those Worker routes. No other consumer found.
