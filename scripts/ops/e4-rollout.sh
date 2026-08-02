#!/usr/bin/env bash
#
# Rollout for Epic E4 (collector account): migrations 0009 and 0010.
#
# Run this from the repo root:
#
#     bash scripts/ops/e4-rollout.sh            # read-only, changes nothing
#     bash scripts/ops/e4-rollout.sh --apply    # also applies the migrations
#
# Without --apply nothing is written, so the first run is always safe.
# Mutations are behind a flag rather than an interactive prompt because
# this is often run through a non-interactive shell, where a prompt gets
# an immediate EOF and silently answers itself. Same shape as
# scripts/ops/e1-rollout.sh.
#
# Nothing is deployed by this script. It prepares the database so that
# deploying is safe, then tells you what to deploy.
#
# The order matters, and this one is worse than it looks. The E4 build's
# collection INSERT always names a `quantity` column, and the new control
# can send list_type='ignore'. The live table (migration 0006) has neither.
# Deploying Pages before 0009 lands breaks EVERY write to /api/collection —
# including the "add to collection/wishlist/trade" flow that is already live
# for all users today. Reads keep working, so it looks like a broken button
# rather than a broken deploy.
#
# See openspec/changes/e4-collector-account/tasks.md.

set -uo pipefail

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-7f76e45b57067d4bfc128d1049a20607}"

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

DB_NAME="filatelia-db"
WORKER_DIR="workers/filatelia-api"
MIGRATIONS_DIR="filatelia-web/db/migrations"

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

# Gate for anything that writes. Without --apply this prints what WOULD
# happen and returns false, so a plain run is always a dry run.
gated() {
  if [[ "$APPLY" == "1" ]]; then
    return 0
  fi
  printf '%s  --%s  would: %s\n' "$yellow" "$reset" "$1"
  info "re-run with --apply to do it"
  return 1
}

# Returns the query result on stdout, or fails loudly. wrangler reports
# failures as a JSON envelope with an "error" key while still exiting 0,
# so checking the exit status alone is not enough — an earlier version of
# the E1 script mistook an error envelope for data and reported a green
# check that had verified nothing.
D1_ERROR=""
d1_query() {
  local out
  out=$(npx wrangler d1 execute "$DB_NAME" --remote --json --command "$1" 2>&1)
  if [[ -z "$out" ]] || echo "$out" | grep -q '"error"'; then
    D1_ERROR=$(echo "$out" | grep -oP '"text"\s*:\s*"\K[^"]{0,200}' | head -1)
    [[ -z "$D1_ERROR" ]] && D1_ERROR="empty response from wrangler"
    return 1
  fi
  D1_ERROR=""
  printf '%s' "$out"
}

die_on_d1() {
  bad "Cannot read production D1: $D1_ERROR"
  info "Every check below depends on this, so nothing further can be trusted."
  info "If it is an account problem, set the right one and re-run:"
  info "  CLOUDFLARE_ACCOUNT_ID=<id> bash scripts/ops/e4-rollout.sh"
  exit 1
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
info "using account $CLOUDFLARE_ACCOUNT_ID"

printf '\n'
info "Reading production D1 ($DB_NAME)..."
if ! d1_query "SELECT 1 AS ping;" >/dev/null; then
  die_on_d1
fi
ok "D1 is readable"

printf '\n'
info "Checking UserCollection for the quantity column (migration 0009)..."
quantity_col=$(d1_query "SELECT COUNT(*) AS n FROM pragma_table_info('UserCollection') WHERE name = 'quantity';") || die_on_d1
if echo "$quantity_col" | grep -qE '"n":\s*0'; then
  bad "UserCollection has NO quantity column. Migration 0009 has not been applied."
  info "Deploying Pages in this state breaks EVERY write to /api/collection,"
  info "including the add-to-collection flow that is already live today."
  QUANTITY_COL="no"
else
  ok "UserCollection has the quantity column."
  QUANTITY_COL="yes"
fi

printf '\n'
info "Checking that 'ignore' is an accepted list_type (same migration)..."
info "The equivalent manual check is: PRAGMA table_info(UserCollection);"
ignore_type=$(d1_query "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='UserCollection' AND sql LIKE '%''ignore''%';") || die_on_d1
if echo "$ignore_type" | grep -qE '"n":\s*0'; then
  bad "The live UserCollection CHECK does not allow list_type='ignore'."
  info "The new four-state control sends it. Migration 0009 covers this too."
  IGNORE_TYPE="no"
else
  ok "list_type='ignore' is allowed by the live CHECK constraint."
  IGNORE_TYPE="yes"
fi

printf '\n'
info "Checking the Order / OrderItem tables (migration 0010)..."
order_tables=$(d1_query "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('Order','OrderItem');") || die_on_d1
if echo "$order_tables" | grep -qE '"n":\s*2'; then
  ok "Both Order and OrderItem exist."
  ORDER_TABLES="yes"
else
  bad "Order/OrderItem are missing or incomplete (expected 2 tables)."
  info "Without them, checkout 500s and /perfil shows no order history."
  ORDER_TABLES="no"
fi

# ---------------------------------------------------------------------------
step "Phase 2 — database migrations"
# ---------------------------------------------------------------------------

if [[ "$QUANTITY_COL" != "yes" || "$IGNORE_TYPE" != "yes" ]]; then
  info "0009_add_quantity_and_ignore_list_type.sql recreates UserCollection with"
  info "a quantity column and with 'ignore' added to the list_type CHECK."
  warn "This one is SINGLE-SHOT, not idempotent in the usual sense: it copies"
  warn "every existing row but seeds quantity = 1. Re-applying it after real"
  warn "quantity values exist would reset them. Run it once."
  if gated "apply 0009 to production D1"; then
    npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATIONS_DIR/0009_add_quantity_and_ignore_list_type.sql" && ok "0009 applied" || bad "0009 failed"
  fi
else
  ok "0009 not needed."
fi

printf '\n'
if [[ "$ORDER_TABLES" != "yes" ]]; then
  info "0010_create_order_tables.sql creates the Order and OrderItem tables"
  info "that back real purchase history. It is idempotent (CREATE TABLE IF NOT"
  info "EXISTS) and safe to run more than once."
  if gated "apply 0010 to production D1"; then
    npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATIONS_DIR/0010_create_order_tables.sql" && ok "0010 applied" || bad "0010 failed"
  fi
else
  ok "0010 not needed."
fi

# ---------------------------------------------------------------------------
step "Phase 3 — re-verify, then deploy"
# ---------------------------------------------------------------------------

cat <<'EOS'
  Re-run this script (without --apply) after applying anything. Deploy only
  once every check above is green.

  1. Pages, which is the only thing E4 deploys. The Worker is untouched.

       cd filatelia-web && npm run build:cf && npx wrangler pages deploy

  2. Smoke test through the real UI, logged in as a collector:
     - On a stamp page: set Coleccion, change the quantity, switch to
       Ignorar and back. Every step must survive a reload.
     - Place one order at /checkout, then confirm it shows up in /perfil
       with the CATALOG price, not whatever the cart held.

  If you deploy out of order, do NOT roll Pages back as a stopgap. Rolling
  back restores collection writes, but it also un-ships the server-side
  order pricing, so the previous build again persists whatever price the
  client posts. Fix forward: apply the migration. It takes effect
  immediately, with no redeploy.
EOS

printf '\n%sDone. Nothing was deployed by this script.%s\n' "$bold" "$reset"
