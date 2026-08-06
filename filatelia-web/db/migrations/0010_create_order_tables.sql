-- D1 Migration v10: create the `Order` and `OrderItem` tables backing real
-- purchase-history persistence for E4.6.
--
-- WHY: `src/app/perfil/PerfilClient.tsx` used to show a hardcoded
-- `DEFAULT_ORDERS` array (fabricated order ids, a fake customer name and
-- Lima address, fake stamps and prices) to whoever logged in, falling back
-- to it whenever `localStorage["fp_orders"]` was empty. `POST
-- /api/orders` only validated the request shape and returned a random
-- `ORD-2026-XXXXX` id without writing anything anywhere. There was no
-- table to write to. This migration adds one.
--
-- Shape matches exactly what the existing UI already renders (see
-- src/types/order.ts: OrderRecord / OrderItem / ShippingDetails) so no
-- further column mapping is needed: order id, owning user, created date,
-- status, total, flattened shipping details, payment method, and per-item
-- stamp id/title/price/quantity/catalog reference ("scott").
--
-- Orders are immutable once created (src/lib/db/orders.ts exposes no
-- update/delete) so there is no `updated_at` column, unlike UserCollection.
--
-- Indexed by user for the per-user listing query (GET /api/orders).
--
-- EDITED IN PLACE (still unexecuted — see the note above) to add an
-- explicit `currency` column to both tables. The store's `Product` rows
-- hold prices in mixed, unlabelled currencies with no way to tell which
-- row is which; `src/lib/db/orders.ts` `priceOrder` now refuses to persist
-- an order whose line currency is unknown or mixed rather than guessing.
-- ISO 4217 codes only ('PEN', 'USD'), enforced at the DB level exactly like
-- `status`/`payment_method` above — belt-and-suspenders with the
-- application-layer check in `priceOrder`.
--
-- NOT EXECUTED BY THIS CHANGE. This file is committed as a reviewable,
-- idempotent artifact only. Running it against the real D1 database is a
-- separate, explicitly user-authorized step (same convention as 0007/0008).

CREATE TABLE IF NOT EXISTS "Order" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT CHECK(status IN ('Pending', 'Processing', 'Completed', 'Cancelled')) NOT NULL DEFAULT 'Pending',
  total_amount REAL NOT NULL,
  currency TEXT CHECK(currency IN ('PEN', 'USD')) NOT NULL,
  payment_method TEXT CHECK(payment_method IN ('mercadopago', 'paypal', 'yape_plin', 'bank_transfer')) NOT NULL,
  shipping_full_name TEXT NOT NULL,
  shipping_address TEXT NOT NULL,
  shipping_city TEXT NOT NULL,
  shipping_postal_code TEXT NOT NULL,
  shipping_phone TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_user ON "Order"(user_id);

-- `price` and `quantity` carry DB-level CHECKs for the same belt-and-
-- suspenders reason 0009 constrains UserCollection.quantity: the API layer
-- (src/lib/db/orders.ts `priceOrder`) already rejects a non-integer or
-- sub-1 quantity and re-derives `price` from `Stamp.marketPriceUsd`
-- instead of trusting the request body, but a table guarding money must
-- not depend on every future write path remembering to do that. A negative
-- price or a zero/negative quantity is never a legitimate order line.
CREATE TABLE IF NOT EXISTS OrderItem (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES "Order"(id),
  stamp_id TEXT NOT NULL,
  title TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0),
  currency TEXT CHECK(currency IN ('PEN', 'USD')) NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity >= 1),
  scott TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_item_order ON OrderItem(order_id);
