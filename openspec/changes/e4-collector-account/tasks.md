# Tasks: Collector Account (Epic E4)

## Checkbox Legend

- `[x]` — done: the artifact was authored AND the operational action it describes was actually performed/verified.
- `[~]` — artifact authored, operational action NOT performed: e.g. a migration file was written but never executed against remote D1. Do not read `[~]` as "done".
- `[ ]` — not started.

## Scope of this document

This is the **deployment runbook** for E4. E4 ships two migrations that the
live database does not have yet, and application code that assumes both of
them are already applied. Deploying in the wrong order breaks a feature that
is live today for every user. Everything below is written for an operator
with `wrangler`/D1 production credentials.

Nothing in this file has been executed. Both migrations are committed as
reviewable artifacts only, following the same convention as 0007/0008 (see
`openspec/changes/archive/2026-08-02-unified-session/tasks.md`).

## Migrations shipped by E4

- [~] `filatelia-web/db/migrations/0009_add_quantity_and_ignore_list_type.sql`
  — recreates `UserCollection` with a `quantity` column and with `'ignore'`
  added to the `list_type` CHECK. **Authored, NOT executed.**
- [~] `filatelia-web/db/migrations/0010_create_order_tables.sql` — creates
  the `"Order"` and `OrderItem` tables that back real purchase-history
  persistence, each row carrying an explicit `currency` column
  (`CHECK(currency IN ('PEN', 'USD'))`). **Authored, NOT executed.**
- [~] `filatelia-web/db/migrations/0011_add_product_currency.sql` — adds a
  nullable `Product.currency` column. **Authored, NOT executed.**

## BLOCKING PRECONDITION — the store cannot take orders until `Product.currency` is populated

`Product.price` has always been stored in MIXED, UNLABELLED currencies —
some rows soles, some dollars, with no existing column to tell them apart.
`src/lib/db/orders.ts` `priceOrder` now refuses to price ANY `Product` row
whose `currency` column is `NULL` (see migration 0011's header) rather than
assuming USD or any other currency. This is intentional and is not a bug to
work around: there is no exchange rate anywhere in this codebase, and
defaulting an unlabelled row would silently misprice whichever rows are
actually soles.

**Practical consequence: after 0009/0010/0011 land, `/checkout` will reject
every order that includes a `Product`-sourced cart line until an operator
sets that product's `currency`.** `Stamp`-sourced lines (the StampCard path)
are unaffected — `Stamp.marketPriceUsd` is hardcoded to `'USD'` in
`priceOrder` because it is USD by its own column name, not read from a
column that could be missing.

- [ ] **Before enabling checkout for the storefront**, an operator must set
  `Product.currency` to `'PEN'` or `'USD'` for every row that should be
  purchasable. This is a manual, per-row decision — nothing in this
  codebase can infer it from existing data.

### Read-only query: which sellable rows are still missing a currency

Run this after 0011 lands, at any time, to check remaining exposure. Pure
read, no writes, safe to run repeatedly:

```
npx wrangler d1 execute filatelia-db --remote --command "SELECT id, name, price, status FROM Product WHERE status = 'ACTIVE' AND currency IS NULL ORDER BY name ASC;"
```

Any row returned here is currently **unsellable**: a buyer can add it to
the cart, but `/api/orders` will reject the order with a 400 rather than
persist a price in a currency nobody declared. Zero rows returned means
every active product has a declared currency and checkout is unblocked for
`Product`-sourced lines.

## CRITICAL — Deployment Runbook (read before deploying Pages)

### Required order

**Migrations 0009, 0010 AND 0011 must all be applied to remote D1 BEFORE the
Pages deploy that carries E4.** This is not the usual "new feature needs its
table" ordering — 0009 is a hard prerequisite for an *already live* feature,
and 0011 is a hard prerequisite for `/checkout` to accept ANY
`Product`-sourced order at all (see the blocking precondition above).

1. **Run migration `0009_add_quantity_and_ignore_list_type.sql` against
   remote D1.**
   - `src/lib/db/collection.ts`'s INSERT now always names a `quantity`
     column, and the new four-state control (`src/lib/collectionControl.ts`,
     `src/components/collection/CollectionControl.tsx`) can send
     `list_type = 'ignore'`. The live table (created by migration 0006) has
     neither.
   - The migration is a create-copy-drop-rename table recreate. Every DDL
     statement is guarded (`IF EXISTS` / `IF NOT EXISTS`), but it is a
     **single-shot** artifact, not one meant for routine repeated execution:
     re-applying it after real `quantity` values exist would reset them to 1
     (see the migration's own header).
   - Apply: `npx wrangler d1 execute filatelia-db --remote --file=filatelia-web/db/migrations/0009_add_quantity_and_ignore_list_type.sql`
2. **Run migration `0010_create_order_tables.sql` against remote D1.**
   - `POST /api/orders` writes an `"Order"` row plus its `OrderItem` rows in
     one transactional D1 `batch()`. Neither table exists in production
     today. The migration is idempotent (`CREATE TABLE IF NOT EXISTS`) and
     safe to run more than once.
   - Apply: `npx wrangler d1 execute filatelia-db --remote --file=filatelia-web/db/migrations/0010_create_order_tables.sql`
3. **Run migration `0011_add_product_currency.sql` against remote D1.**
   - Adds a nullable `Product.currency` column. Does NOT populate it — see
     "BLOCKING PRECONDITION" above. `src/lib/db/orders.ts` `priceOrder`
     rejects any order line whose `Product.currency` is `NULL`, so this
     migration landing is necessary but not sufficient: checkout for
     `Product`-sourced lines stays broken until the currency column is also
     populated per-row.
   - Apply: `npx wrangler d1 execute filatelia-db --remote --file=filatelia-web/db/migrations/0011_add_product_currency.sql`
4. **Verify all three landed with the read-only queries below** before
   deploying anything.
5. **Only once 1–4 are verified, deploy Pages**:
   `cd filatelia-web && npm run build:cf && npx wrangler pages deploy`
6. **Post-deploy smoke test** through the real UI, as a logged-in
   collector:
   - Open a stamp detail page, set it to *Colección*, change the quantity,
     then switch it to *Ignorar* and back. Each action must persist across a
     page reload.
   - Place one order for a `Stamp`-sourced item (StampCard path) through
     `/checkout`, then confirm it appears in `/perfil` → *Historial de
     Pedidos* with the **catalog** price and `US$`, not whatever the cart
     happened to hold.
   - Separately confirm that a `Product`-sourced cart line is refused at
     `/checkout` with a Spanish explanation, NOT a silent total, until an
     operator sets that product's `currency` (expected until the precondition
     above is satisfied).

The Worker (`workers/filatelia-api`) is **not** part of this rollout. E4
touches only the Next app and the database.

### Read-only verification queries (no writes, no DDL)

Run these after step 1/2 and before step 4. Both are pure reads and safe to
run at any time.

- **0009 — does `UserCollection` have the `quantity` column?**

  ```
  npx wrangler d1 execute filatelia-db --remote --command "PRAGMA table_info(UserCollection);"
  ```

  Expect a row whose `name` is `quantity` (type `INTEGER`, `notnull` 1,
  `dflt_value` 1). If no such row comes back, 0009 has **not** landed — do
  not deploy.

  To confirm the `'ignore'` list type is accepted as well (the same
  migration widens that CHECK):

  ```
  npx wrangler d1 execute filatelia-db --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='UserCollection';"
  ```

  The returned DDL must contain `'ignore'` inside the `list_type` CHECK.

- **0010 — do the order tables exist?**

  ```
  npx wrangler d1 execute filatelia-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Order','OrderItem');"
  ```

  Expect **two** rows. Zero or one row means 0010 has not fully landed.

- **0011 — does `Product` have the `currency` column?**

  ```
  npx wrangler d1 execute filatelia-db --remote --command "PRAGMA table_info(Product);"
  ```

  Expect a row whose `name` is `currency`. If no such row comes back, 0011
  has **not** landed — do not deploy. Landing 0011 alone does NOT unblock
  checkout; see "Read-only query: which sellable rows are still missing a
  currency" above.

### Symptom if deployed out of order

**If Pages ships before 0009 runs, EVERY write to `/api/collection` fails —
not just the new features.** `addCollectionItem`'s INSERT names a `quantity`
column the live table does not have, so D1 answers
`no such column: quantity` for every add, and the same applies to any write
carrying `list_type = 'ignore'` (`CHECK constraint failed`). The already-live
"añadir a colección / deseos / intercambio" flow breaks for all users at
once. The route surfaces this as a generic `400`, so the UI shows
"Datos inválidos." and nothing in the client says the database is the
problem — check the Pages function logs for `no such column: quantity`.

Reads are unaffected: `getUserCollection` uses `SELECT u.*`, so existing
lists keep rendering. That makes the failure look like a broken button
rather than a broken deploy, which is exactly why it is easy to misdiagnose.

**If Pages ships before 0010 runs**, every `POST /api/orders` fails with
`no such table: Order` and every `GET /api/orders` 500s, so checkout is dead
and `/perfil` shows "No se pudo cargar el historial de pedidos". This one is
loud and affects only the new feature.

**If Pages ships before 0011 runs**, `priceOrder`'s `SELECT ... p.currency
AS currency ... FROM Product` fails with `no such column: currency` for
EVERY `Product`-sourced order line — this is a database/infrastructure
incident (logged as `console.error`), not the ordinary "currency not yet
declared" rejection (logged as `console.warn`). `Stamp`-sourced orders
(StampCard path) are unaffected, since that query never selects
`Product.currency`.

### Recovery

**Run the migration. Do not roll back.**

- Rolling Pages back to the pre-E4 build restores collection writes, but it
  also un-ships the server-authoritative order pricing
  (`src/lib/db/orders.ts` `priceOrder`). The previous build persisted
  whatever `price`/`totalAmount` the client posted, so a rollback re-opens
  a live price-tampering hole for as long as it is deployed. Treat rollback
  as a last resort with a known cost, not a neutral undo.
- The fix-forward is a single command (step 1 and/or step 2 above) and takes
  effect immediately, with no redeploy: the migrations change only the
  database, and the deployed code starts working the moment the columns and
  tables exist.
- After applying, re-run the verification queries, then re-test one
  collection write and one order through the UI.

### Helper script

`scripts/ops/e4-rollout.sh` performs exactly the read-only preflight above
and, only with `--apply`, runs the two migrations. Same shape as
`scripts/ops/e1-rollout.sh`: a plain run writes nothing.

```
bash scripts/ops/e4-rollout.sh            # read-only, changes nothing
bash scripts/ops/e4-rollout.sh --apply    # also applies 0009 and 0010
```

The script deploys nothing. It has **not** been run.
