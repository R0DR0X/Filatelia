#!/usr/bin/env bash
#
# Rollout for Epic E3 (ficha con paridad Colnect) and the E2.6 import fix:
# migrations 0012 and 0013.
#
# Run this from the repo root:
#
#     bash scripts/ops/e3-rollout.sh            # read-only, changes nothing
#     bash scripts/ops/e3-rollout.sh --apply    # also applies the migrations
#
# Without --apply nothing is written, so the first run is always safe.
# Mutations are behind a flag rather than an interactive prompt because this is
# often run through a non-interactive shell, where a prompt gets an immediate
# EOF and silently answers itself. Same shape as e1-rollout.sh and e4-rollout.sh.
#
# ORDER. Unlike E4, this one is not a trap: 0012 only ADDS nullable columns and
# a new table, so it is safe before or after the deploy, and the new code reads
# the new columns as NULL until the scraper fills them. Migration 0013 is the
# one that matters operationally — it is what makes `POST /import-stamp` work
# at all for Colnect stamps (see below).
#
# WHAT 0013 FIXES (PENDIENTES.md E2.6). importStampHandler upserts non-WNS
# stamps with ON CONFLICT(sourceUrl), and `Stamp.sourceUrl` has never had a
# UNIQUE index. SQLite rejects that statement while PARSING it, so every
# Colnect stamp in a batch fails and the batch persists 0 of N. Until 0013 is
# applied, resuming the Colnect detail phase writes nothing no matter how much
# proxy bandwidth you spend on it.
#
# Nothing is deployed by this script. It prepares the database so that
# deploying is safe, then tells you what to deploy.

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

# Gate for anything that writes. Without --apply this prints what WOULD happen
# and returns false, so a plain run is always a dry run.
gated() {
  if [[ "$APPLY" == "1" ]]; then
    return 0
  fi
  printf '%s  --%s  would: %s\n' "$yellow" "$reset" "$1"
  info "re-run with --apply to do it"
  return 1
}

# Returns the query result on stdout, or fails loudly. wrangler reports
# failures as a JSON envelope with an "error" key while still exiting 0, so
# checking the exit status alone is not enough.
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
  info "  CLOUDFLARE_ACCOUNT_ID=<id> bash scripts/ops/e3-rollout.sh"
  exit 1
}

# Pulls the single integer out of a wrangler --json result envelope.
scalar() {
  echo "$1" | grep -oP '"n"\s*:\s*\K-?\d+' | head -1
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
if ! d1_query "SELECT 1 AS n;" >/dev/null; then
  die_on_d1
fi
ok "D1 is readable"

printf '\n'
info "Checking Stamp for the four E3 columns (migration 0012)..."
detail_cols=$(d1_query "SELECT COUNT(*) AS n FROM pragma_table_info('Stamp') WHERE name IN ('colnectCode','format','emission','gum');") || die_on_d1
if [[ "$(scalar "$detail_cols")" == "4" ]]; then
  ok "Stamp already has colnectCode, format, emission and gum."
  DETAIL_COLS="yes"
else
  warn "Stamp is missing some of colnectCode/format/emission/gum (found $(scalar "$detail_cols") of 4)."
  info "The detail page renders fine without them — every field degrades to"
  info "hidden — so this is not urgent, but the scraper cannot store them."
  DETAIL_COLS="no"
fi

printf '\n'
info "Checking the StampVariant table (migration 0012)..."
variant_table=$(d1_query "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='StampVariant';") || die_on_d1
if [[ "$(scalar "$variant_table")" == "1" ]]; then
  ok "StampVariant exists."
  VARIANT_TABLE="yes"
else
  warn "StampVariant does not exist."
  info "GET /stamp/:id already tolerates this and returns variants: []."
  VARIANT_TABLE="no"
fi

printf '\n'
info "Checking the UNIQUE index on Stamp.sourceUrl (migration 0013)..."
url_index=$(d1_query "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='Stamp' AND name='idx_stamp_source_url';") || die_on_d1
if [[ "$(scalar "$url_index")" == "1" ]]; then
  ok "idx_stamp_source_url exists — /import-stamp can upsert Colnect stamps."
  URL_INDEX="yes"
else
  bad "Stamp.sourceUrl has NO unique index."
  info "This is PENDIENTES.md E2.6. Every non-WNS import — which is every"
  info "Colnect stamp — fails to parse and the batch persists 0 of N."
  info "Resuming the detail phase before this lands burns proxy GB for nothing."
  URL_INDEX="no"
fi

printf '\n'
info "Counting duplicate sourceUrl values (this decides whether 0013 CAN apply)..."
dupes=$(d1_query "SELECT COUNT(*) AS n FROM (SELECT sourceUrl FROM Stamp WHERE sourceUrl IS NOT NULL GROUP BY sourceUrl HAVING COUNT(*) > 1);") || die_on_d1
DUPES=$(scalar "$dupes")
if [[ "$DUPES" == "0" ]]; then
  ok "No duplicate sourceUrl values. The unique index can be created."
else
  bad "$DUPES sourceUrl values appear on more than one Stamp row."
  info "Creating the unique index WILL fail until these are resolved, and that"
  info "is the correct outcome — it means the importer has been treating"
  info "distinct rows as the same stamp. Look at them before deleting anything:"
  info ""
  info "  npx wrangler d1 execute $DB_NAME --remote --command \\"
  info "    \"SELECT sourceUrl, COUNT(*) c, GROUP_CONCAT(id) ids FROM Stamp \\"
  info "     WHERE sourceUrl IS NOT NULL GROUP BY sourceUrl HAVING c > 1 LIMIT 20;\""
fi

# ---------------------------------------------------------------------------
step "Phase 2 — database migrations"
# ---------------------------------------------------------------------------

if [[ "$DETAIL_COLS" != "yes" || "$VARIANT_TABLE" != "yes" ]]; then
  info "0012_stamp_detail_fields.sql adds colnectCode/format/emission/gum to"
  info "Stamp and creates StampVariant. Additive and safe to run before the"
  info "deploy: existing readers and writers are unaffected."
  warn "The ALTER TABLE statements are NOT idempotent — SQLite has no"
  warn "ADD COLUMN IF NOT EXISTS. If only some of the four columns are"
  warn "missing, apply the missing ones by hand instead of re-running the file."
  if gated "apply 0012 to production D1"; then
    npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATIONS_DIR/0012_stamp_detail_fields.sql" && ok "0012 applied" || bad "0012 failed"
  fi
else
  ok "0012 not needed."
fi

printf '\n'
if [[ "$URL_INDEX" != "yes" ]]; then
  if [[ "$DUPES" != "0" ]]; then
    bad "Refusing to apply 0013: $DUPES duplicate sourceUrl values must be resolved first."
    info "Applying it now would just fail with an opaque index error."
  else
    info "0013_stamp_source_url_unique.sql creates the UNIQUE index that"
    info "POST /import-stamp has always assumed. Idempotent."
    if gated "apply 0013 to production D1"; then
      npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATIONS_DIR/0013_stamp_source_url_unique.sql" && ok "0013 applied" || bad "0013 failed"
    fi
  fi
else
  ok "0013 not needed."
fi

# ---------------------------------------------------------------------------
step "Phase 3 — re-verify, then deploy"
# ---------------------------------------------------------------------------

cat <<'EOS'
  Re-run this script (without --apply) after applying anything. Deploy only
  once every check above is green.

  E3 deploys BOTH sides, unlike E4:

  1. The Worker — GET /stamp/:id now returns `variants`, and GET /stamps
     accepts `theme` and `groupId` filters:

       cd workers/filatelia-api && npx wrangler deploy

  2. Pages:

       cd filatelia-web && npm run build:cf && npx wrangler pages deploy

  Deploy the Worker FIRST. Pages renders the theme and series links, and those
  links land on /biblioteca, which forwards `theme`/`groupId` to the Worker. An
  older Worker ignores unknown query params, so shipping Pages first makes
  those links look like they work while quietly returning the whole catalogue.

  3. Smoke test:
     - Open any stamp. The technical block should look the same as before —
       the four new fields are NULL for all 147,555 rows until the Colnect
       detail phase runs, and NULL fields are hidden, not blank.
     - Click the country in the breadcrumb. /biblioteca must come up FILTERED,
       with a chip showing the filter. Before this change it silently showed
       the unfiltered catalogue.
     - Click the theme and the series. Same: filtered, with a removable chip.

  4. Only after 0013 is green is it worth spending proxy GB on the Colnect
     detail phase (E2.7). Verify with a batch of 3 before running 14,396.
EOS

printf '\n%sDone. Nothing was deployed by this script.%s\n' "$bold" "$reset"
