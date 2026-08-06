#!/usr/bin/env bash
#
# Two data corrections that need an operator's judgement, not just a schema:
# migration 0014 (declare Product.currency) and 0015 (clear Colnect's anti-bot
# text out of Stamp.theme).
#
#     bash scripts/ops/data-cleanup.sh            # read-only survey
#     bash scripts/ops/data-cleanup.sh --apply    # also applies 0014 and 0015
#
# These differ from the other rollout scripts in kind: e1/e3/e4 change the
# SHAPE of the database, and are reversible in the sense that re-running a
# CREATE or an ADD COLUMN converges. These change CONTENT. 0015 overwrites
# theme values with NULL and there is no copy of the old values anywhere, so
# the survey below is not a formality — it is the only chance to look before
# the data is gone.
#
# Read the survey output. If it lists a theme you recognise as a real one, STOP
# and remove it from the migration rather than accepting the loss.

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

gated() {
  if [[ "$APPLY" == "1" ]]; then
    return 0
  fi
  printf '%s  --%s  would: %s\n' "$yellow" "$reset" "$1"
  info "re-run with --apply to do it"
  return 1
}

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
  info "Nothing below can be trusted, so nothing will be applied."
  exit 1
}

scalar() { echo "$1" | grep -oP '"n"\s*:\s*\K-?\d+' | head -1; }

if [[ ! -d "$WORKER_DIR" ]]; then
  bad "Run this from the repository root (did not find $WORKER_DIR)."
  exit 1
fi

if ! npx wrangler whoami >/dev/null 2>&1; then
  bad "wrangler is not authenticated (CLOUDFLARE_API_TOKEN)."
  exit 1
fi

# ---------------------------------------------------------------------------
step "Survey 1 — Product rows with no declared currency (migration 0014)"
# ---------------------------------------------------------------------------

info "These are the rows the store currently REFUSES to sell:"
printf '\n'
npx wrangler d1 execute "$DB_NAME" --remote \
  --command "SELECT id, name, price, currency FROM Product WHERE currency IS NULL ORDER BY price;" 2>&1 | tail -25

null_currency=$(d1_query "SELECT COUNT(*) AS n FROM Product WHERE currency IS NULL;") || die_on_d1
NULL_CURRENCY=$(scalar "$null_currency")
printf '\n'
if [[ "$NULL_CURRENCY" == "0" ]]; then
  ok "Every Product already declares a currency. 0014 is not needed."
else
  warn "$NULL_CURRENCY product(s) have no currency."
  info "0014 sets them all to USD. That is an operator statement, not a fact"
  info "derived from the data — Rodrigo confirmed these are dollar prices on"
  info "2026-08-06. If any row above is actually in soles, DO NOT APPLY:"
  info "set that row by hand first, then run this."
fi

# ---------------------------------------------------------------------------
step "Survey 2 — themes that are scraper artifacts, not themes (migration 0015)"
# ---------------------------------------------------------------------------

info "Every distinct theme containing anti-bot / paywall wording."
info "Migration 0015 only clears EXACT matches of the two known strings; this"
info "survey is deliberately WIDER so anything new shows up here first."
printf '\n'
npx wrangler d1 execute "$DB_NAME" --remote --command \
  "SELECT theme, COUNT(*) AS c FROM Stamp
    WHERE theme IS NOT NULL
      AND (theme LIKE '%login%' OR theme LIKE '%human%' OR theme LIKE '%sign in%'
           OR theme LIKE '%complete item%' OR theme LIKE '%view details%'
           OR theme LIKE '%javascript%' OR theme LIKE '%cookie%')
    GROUP BY theme ORDER BY c DESC;" 2>&1 | tail -30

printf '\n'
targeted=$(d1_query "SELECT COUNT(*) AS n FROM Stamp WHERE theme IN ('Login to see complete item details','Confirm you are human to view details');") || die_on_d1
TARGETED=$(scalar "$targeted")
info "Migration 0015 would clear exactly $TARGETED row(s)."
warn "If the survey above lists a value 0015 does NOT cover, add it to the"
warn "migration as another exact literal. Do not widen it into a LIKE — a"
warn "pattern would also erase genuine themes containing those words, across"
warn "147,555 rows, with no record of which ones were real."
warn "There is no backup of these values. Once cleared, they are gone."

# ---------------------------------------------------------------------------
step "Apply"
# ---------------------------------------------------------------------------

if [[ "$NULL_CURRENCY" != "0" ]]; then
  if gated "apply 0014 (declare every NULL Product.currency as USD)"; then
    npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATIONS_DIR/0014_declare_product_currency_usd.sql" && ok "0014 applied" || bad "0014 failed"
  fi
else
  ok "0014 not needed."
fi

printf '\n'
if [[ "$TARGETED" != "0" ]]; then
  if gated "apply 0015 (clear $TARGETED anti-bot theme values)"; then
    npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATIONS_DIR/0015_clear_scraped_antibot_themes.sql" && ok "0015 applied" || bad "0015 failed"
  fi
else
  ok "0015 not needed."
fi

cat <<'EOS'

  Neither migration needs a redeploy. Both take effect on the next request:
  the Worker reads Product.currency and Stamp.theme live.

  After applying, check:
    - /checkout can price a product again (it could not while currency was NULL)
    - a stamp that used to show "Login to see complete item details" as its
      theme now shows no theme chip at all, rather than an empty one

  The scraper still needs fixing: an unauthenticated listing run will store
  these strings again. That belongs with E2, where the Colnect session
  handling lives.
EOS

printf '\n%sDone.%s\n' "$bold" "$reset"
