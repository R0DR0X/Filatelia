#!/usr/bin/env bash
#
# Rollout for Epic E1 (unified-session) and the E2 public-write-surface fix.
#
# Run this from the repo root:
#
#     bash scripts/ops/e1-rollout.sh
#
# Phase 1 is read-only and runs unattended. Every step that changes
# production asks first and can be skipped. Nothing is deployed by this
# script: it prepares the database and the secrets so that deploying is
# safe, then tells you what to deploy and in which order.
#
# The order matters. Deploying the Worker before the admin role is seeded
# and ADMIN_API_TOKEN exists locks you out of /admin with no way back
# through the UI. See openspec/changes/unified-session/tasks.md.

set -uo pipefail

DB_NAME="filatelia-db"
WORKER_DIR="workers/filatelia-api"
PAGES_PROJECT="filatelia-web"
MIGRATIONS_DIR="filatelia-web/db/migrations"
WORKER_URL="https://filatelia-api.rodrigopianto2005.workers.dev"
LEAKED_JWT_SECRET="fp-secret-2024-filatelia-peruana-secure"

bold=$(tput bold 2>/dev/null || true)
red=$(tput setaf 1 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true)
yellow=$(tput setaf 3 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)

step() { printf '\n%s== %s ==%s\n' "$bold" "$1" "$reset"; }
ok()   { printf '%s  ok%s  %s\n' "$green" "$reset" "$1"; }
warn() { printf '%s  !!%s  %s\n' "$yellow" "$reset" "$1"; }
bad()  { printf '%s  XX%s  %s\n' "$red" "$reset" "$1"; }
info() { printf '      %s\n' "$1"; }

confirm() {
  local answer
  printf '\n%s%s%s [y/N] ' "$bold" "$1" "$reset"
  read -r answer
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

d1_query() {
  npx wrangler d1 execute "$DB_NAME" --remote --json --command "$1" 2>/dev/null
}

if [[ ! -d "$WORKER_DIR" ]]; then
  bad "Run this from the repository root (did not find $WORKER_DIR)."
  exit 1
fi

# ---------------------------------------------------------------------------
step "Phase 1 — read-only preflight (changes nothing)"
# ---------------------------------------------------------------------------

if ! npx wrangler whoami >/dev/null 2>&1; then
  bad "wrangler is not authenticated. Run: npx wrangler login"
  exit 1
fi
ok "wrangler is authenticated"

printf '\n'
info "Checking the admin role seed (task 0.2)..."
role_rows=$(d1_query "SELECT COUNT(*) AS n FROM UserRole ur JOIN Role r ON r.id = ur.roleId WHERE r.name = 'admin';")
if [[ -z "$role_rows" ]]; then
  warn "Could not read UserRole/Role. The tables may not exist yet; migration 0007 creates the seed."
  ROLE_SEEDED="unknown"
elif echo "$role_rows" | grep -q '"n": *0'; then
  bad "NO admin role is seeded. Migration 0007 has not been applied."
  info "Deploying the Worker in this state locks you out of /admin."
  ROLE_SEEDED="no"
else
  ok "An admin role link exists."
  ROLE_SEEDED="yes"
fi

printf '\n'
info "Checking the SiteVisit table (migration 0008)..."
site_visit=$(d1_query "SELECT name FROM sqlite_master WHERE type='table' AND name='SiteVisit';")
if echo "$site_visit" | grep -q 'SiteVisit'; then
  ok "SiteVisit exists. The old handler created it on demand, as expected."
  SITE_VISIT="yes"
else
  bad "SiteVisit does NOT exist. Analytics will silently record nothing after deploy."
  SITE_VISIT="no"
fi

printf '\n'
info "Checking the admin password hash format (task 0.1)..."
info "This prints only the LENGTH and shape of the hash, never the hash itself."
hash_shape=$(d1_query "SELECT email, LENGTH(password) AS len, (INSTR(password, ':') > 0) AS has_salt_separator FROM User WHERE password IS NOT NULL;")
if [[ -n "$hash_shape" ]]; then
  echo "$hash_shape" | grep -E '"(email|len|has_salt_separator)"' || echo "$hash_shape"
  info "Expected for a PBKDF2 row written by the Next app: len 97, has_salt_separator 1."
  info "A row that does not match cannot log in and needs its password reset."
else
  warn "Could not read the User table."
fi

# ---------------------------------------------------------------------------
step "Phase 2 — database migrations (asks before each)"
# ---------------------------------------------------------------------------

if [[ "$ROLE_SEEDED" != "yes" ]]; then
  info "About to apply $MIGRATIONS_DIR/0007_seed_admin_role.sql (idempotent)."
  info "This seeds Role('admin') and links it to the owner account, which is what"
  info "lets the Next app resolve role=admin and reach /admin after the cutover."
  if confirm "Apply migration 0007 to PRODUCTION D1?"; then
    npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATIONS_DIR/0007_seed_admin_role.sql" && ok "0007 applied" || bad "0007 failed"
  else
    warn "Skipped 0007. Do NOT deploy the Worker until this is applied."
  fi
else
  ok "0007 not needed."
fi

if [[ "$SITE_VISIT" != "yes" ]]; then
  printf '\n'
  info "About to apply $MIGRATIONS_DIR/0008_create_site_visit.sql (idempotent)."
  if confirm "Apply migration 0008 to PRODUCTION D1?"; then
    npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATIONS_DIR/0008_create_site_visit.sql" && ok "0008 applied" || bad "0008 failed"
  else
    warn "Skipped 0008. Analytics will record nothing until it is applied."
  fi
else
  ok "0008 not needed."
fi

# ---------------------------------------------------------------------------
step "Phase 3 — ADMIN_API_TOKEN"
# ---------------------------------------------------------------------------

info "This token is the ONLY thing that authorizes the Worker's admin surface"
info "after the cutover. It must be identical in three places: the Worker"
info "secret, the Pages environment variable, and the scraper hosts."

TOKEN=""
if confirm "Generate a new ADMIN_API_TOKEN and set it on the Worker?"; then
  TOKEN=$(openssl rand -hex 32)
  printf '\n%sADMIN_API_TOKEN=%s%s\n' "$bold" "$TOKEN" "$reset"
  info "Copy it now. It is not stored anywhere by this script."
  printf '\n'
  if (cd "$WORKER_DIR" && printf '%s' "$TOKEN" | npx wrangler secret put ADMIN_API_TOKEN); then
    ok "Worker secret set. This takes effect without redeploying."
  else
    bad "Failed to set the Worker secret."
  fi
  printf '\n'
  warn "Now set the SAME value in the two places this script cannot reach:"
  info "1. Pages -> $PAGES_PROJECT -> Settings -> Environment variables"
  info "   ADMIN_API_TOKEN (encrypted), for BOTH production and preview."
  info "   Also confirm APP_SECRET is set there, in both environments."
  info "2. The scraper host (the Piura VM): export ADMIN_API_TOKEN=... in the"
  info "   environment the scrapers run in. All four scrapers now refuse to"
  info "   start without it."
  printf '\n'
  read -r -p "Press enter once both are done. "
else
  warn "Skipped. If a token already exists in all three places, that is fine."
fi

# ---------------------------------------------------------------------------
step "Phase 4 — verify the Worker hop before deploying anything"
# ---------------------------------------------------------------------------

if [[ -z "$TOKEN" ]]; then
  printf 'Paste the ADMIN_API_TOKEN to test with (input hidden, enter to skip): '
  read -rs TOKEN
  printf '\n'
fi

if [[ -n "$TOKEN" ]]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -X GET "$WORKER_URL/admin/stamps?limit=1" -H "X-Admin-Token: $TOKEN")
  if [[ "$code" == "403" ]]; then
    bad "The Worker rejected the token (403)."
    info "The deployed Worker's secret does not match what you just pasted."
    info "Re-run phase 3 before going further."
  elif [[ "$code" == "200" ]]; then
    ok "The Worker accepted the service token."
  else
    warn "Unexpected status $code. Not a 403, so authorization is probably fine."
  fi

  code=$(curl -s -o /dev/null -w '%{http_code}' -X GET "$WORKER_URL/admin/stamps?limit=1")
  if [[ "$code" == "403" ]]; then
    ok "An unauthenticated admin request is refused."
  else
    bad "An unauthenticated admin request returned $code, expected 403."
  fi
else
  warn "Skipped the hop verification."
fi

# ---------------------------------------------------------------------------
step "Phase 5 — what to deploy, in this order"
# ---------------------------------------------------------------------------

cat <<'EOS'
  Deploy only once the checks above are green.

  1. Pages first, so the proxy and the session routes exist before the
     Worker stops accepting the old cookie:

       cd filatelia-web && npm run build:cf && npx wrangler pages deploy

  2. Then the Worker, which is the irreversible half. It deletes /auth/*
     and makes requireAdmin token-only:

       cd workers/filatelia-api && npx wrangler deploy

  3. Smoke test through the real UI: log in, open /admin, edit one stamp,
     and confirm the change persists.

  Rolling the Worker back is NOT a neutral undo. The previous build carries
  the leaked JWT_SECRET in wrangler.toml as a plaintext var, together with
  the cookie path that trusts it and the two privilege-escalation rules.
  Rolling back reopens the admin takeover. If you need to recover, fix
  forward through phases 2 and 3 instead.
EOS

# ---------------------------------------------------------------------------
step "Phase 6 — rotate the leaked secret"
# ---------------------------------------------------------------------------

warn "JWT_SECRET was committed in plaintext and must be treated as leaked:"
info "  $LEAKED_JWT_SECRET"
info "Removing it from wrangler.toml does not clear it from a build that is"
info "already deployed. After the new Worker is live and verified, delete it:"
info ""
info "  cd $WORKER_DIR && npx wrangler secret delete JWT_SECRET"
info ""
info "It is also in git history. Anyone with repo access has it."

printf '\n%sDone. Nothing was deployed by this script.%s\n' "$bold" "$reset"
