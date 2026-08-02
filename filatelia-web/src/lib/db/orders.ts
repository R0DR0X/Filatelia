import { CreateOrderPayload, OrderItem, OrderRecord } from "@/types/order";
import { OrderCurrency, isKnownCurrency, resolveShippingCost } from "@/lib/orderCurrency";

// D1-backed access for the `Order`/`OrderItem` tables (migration
// 0010_create_order_tables.sql). Follows the same direct-binding pattern as
// src/lib/db/collection.ts and src/lib/db/users.ts: no network fallback, no
// SQL gateway. An environment without the DB binding simply cannot run
// these queries.
//
// Orders are immutable once created: this module intentionally exposes no
// update/delete function.
function getD1(): any {
  const d1 = (process.env as any).DB;
  if (!d1 || typeof d1.prepare !== "function") {
    throw new Error(
      "D1 binding 'DB' is unavailable in this environment. The remote SQL gateway " +
      "has been removed for security reasons; run this code where the D1 binding " +
      "is attached (e.g. `wrangler pages dev`)."
    );
  }
  return d1;
}

const runQuery = async (sql: string, params: any[] = []): Promise<any[]> => {
  const res = await getD1().prepare(sql).bind(...params).all();
  return res.results || [];
};

/**
 * Runs several statements as ONE D1 batch. D1 wraps a batch in an implicit
 * transaction, so either every statement lands or none does — which is the
 * only reason an order and its items can be written without risking an
 * orphaned Order row carrying half its items. Same call shape the Worker
 * already uses (workers/filatelia-api/src/index.ts).
 */
const runBatch = async (statements: { sql: string; params: any[] }[]): Promise<any[][]> => {
  const d1 = getD1();
  if (typeof d1.batch !== "function") {
    throw new Error(
      "D1 binding 'DB' does not support batch(). Order writes must be atomic; " +
      "run this code against a real D1 binding (e.g. `wrangler pages dev`)."
    );
  }
  const prepared = statements.map(({ sql, params }) => d1.prepare(sql).bind(...params));
  const results = await d1.batch(prepared);
  return (results || []).map((res: any) => res?.results || []);
};

// Server-side only, same convention as src/app/api/admin/[...path]/route.ts:
// these lines exist so an operator can tell a rejected payload apart from a
// database failure. Client-visible bodies stay opaque.
const LOG_PREFIX = "[db/orders]";

/**
 * Raised when the CALLER's payload is unacceptable (empty cart, bad
 * quantity, an id that exists in no catalog, a catalog entry with no usable
 * price). Distinct from a D1/infrastructure failure so the route can log the
 * two apart — the client-visible body is deliberately the same opaque
 * message either way.
 */
export class OrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderValidationError";
  }
}

// Server-side pricing rules. Everything monetary AND everything descriptive
// on an order line is recomputed HERE, from the catalog, because everything
// in the request body is attacker controlled:
//
//   line price    = catalog price                (never `item.price`)
//   line title    = catalog name                 (never `item.title`)
//   line scott    = catalog catalogue number      (never `item.scott`)
//   line currency = catalog currency              (never invented)
//   subtotal      = Σ line price × quantity        — only once every line
//                    resolves to the SAME currency, see below
//   shipping      = resolveShippingCost(order currency)
//   total         = subtotal + shipping
//
// WHICH catalog: the cart is populated by src/app/(public)/tienda/page.tsx,
// whose products come from /api/products → prisma.product.findMany() →
// `SELECT * FROM Product`. A cart line therefore carries a `Product.id`, and
// `Product.price` is the number the buyer was shown. Pricing those ids
// against `Stamp` (a different primary-key namespace) resolves nothing and
// rejects every real order.
//
// src/components/catalog/StampCard.tsx has a second add-to-cart path that
// contributes a bare `Stamp.id` when rendered with `isForSale && price`. No
// caller passes `isForSale` today, so that path is currently unreachable,
// but the component is live and the ids are a different namespace — so an
// unresolved id is retried against `Stamp.marketPriceUsd` (the same column
// StampCard and SelloDetailClient render) before being rejected. An id that
// matches neither table is rejected; a price is never guessed.
//
// CURRENCY: `Product.price` is stored in MIXED, UNLABELLED currencies —
// some rows are soles, some are dollars, and (until an operator populates
// `Product.currency`, see db/migrations/0011_add_product_currency.sql) most
// rows do not say which. `Stamp.marketPriceUsd` IS unambiguously USD by its
// own column name, so Stamp-sourced lines are hardcoded to 'USD' below
// rather than read from any column. A Product-sourced line with a NULL
// `currency` is UNKNOWN, never defaulted to USD or anything else — see
// summarizeOrderCurrency() below. There is no exchange rate anywhere in
// this codebase and none is invented here.

/** Currency arithmetic in floats: round to cents so 0.1+0.2 never leaks. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface PricedOrder {
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  totalAmount: number;
  currency: OrderCurrency;
}

/** One resolved catalog line: everything the order record is allowed to say. */
interface CatalogEntry {
  price: number;
  title: string;
  scott?: string;
  /** `null` means the catalog row has not declared a currency — UNKNOWN, never defaulted. */
  currency: OrderCurrency | null;
}

/**
 * Where a catalog row's currency comes from:
 *   - "from-row": read `row.currency`, treating anything other than exactly
 *     'PEN'/'USD' as unknown (null). Used for `Product`, whose `currency`
 *     column is nullable and mixed today.
 *   - "usd": ignore whatever the row contains and force 'USD'. Used for
 *     `Stamp`, because `marketPriceUsd` is USD by its own column name —
 *     Stamp's OWN `currency` column means something different (the face
 *     value's currency) and must never be read here.
 */
type CurrencySource = "from-row" | "usd";

/**
 * Collects the rows a catalog query returned into `entries`, keyed by id.
 * A row with an unusable price (null, NaN, negative) is skipped so the
 * caller rejects the id instead of persisting a bogus number.
 */
function collectCatalogRows(
  rows: any[],
  entries: Map<string, CatalogEntry>,
  currencySource: CurrencySource
): void {
  for (const row of rows) {
    if (typeof row?.id !== "string" || entries.has(row.id)) continue;
    const price = typeof row.price === "number" ? row.price : NaN;
    if (!Number.isFinite(price) || price < 0) continue;
    const title = typeof row.title === "string" && row.title.trim() ? row.title : "Artículo de catálogo";
    const scott = typeof row.scott === "string" && row.scott.trim() ? row.scott : undefined;
    const currency: OrderCurrency | null =
      currencySource === "usd" ? "USD" : isKnownCurrency(row.currency) ? row.currency : null;
    entries.set(row.id, { price, title, scott, currency });
  }
}

/**
 * Re-derives every monetary AND descriptive value of an order from the
 * catalog, ignoring `item.price`, `item.title`, `item.scott`, `subtotal`,
 * `shippingCost` and `totalAmount` in the payload entirely. Throws
 * OrderValidationError rather than inventing a price for an id it cannot
 * resolve.
 */
export async function priceOrder(payload: CreateOrderPayload): Promise<PricedOrder> {
  const items = payload?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderValidationError("Order contains no items");
  }

  for (const item of items) {
    if (typeof item?.id !== "string" || !item.id.trim()) {
      throw new OrderValidationError("Order item is missing a catalog id");
    }
    if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new OrderValidationError(
        `Invalid quantity '${item.quantity}' for item '${item.id}'. Must be an integer >= 1.`
      );
    }
  }

  const catalogIds = Array.from(new Set(items.map((item) => item.id)));
  const catalog = new Map<string, CatalogEntry>();

  // 1. `Product` — the table the cart actually draws from. Only ACTIVE rows
  //    are sellable, which is the same filter /api/products applies. The
  //    LEFT JOIN carries the catalogue number for stamp-backed products
  //    without a second round trip.
  const productPlaceholders = catalogIds.map(() => "?").join(", ");
  collectCatalogRows(
    await runQuery(
      `SELECT p.id AS id, p.name AS title, p.price AS price, p.currency AS currency, s.scottNumber AS scott
       FROM Product p LEFT JOIN Stamp s ON s.id = p.stampId
       WHERE p.status = 'ACTIVE' AND p.id IN (${productPlaceholders})`,
      catalogIds
    ),
    catalog,
    "from-row"
  );

  // 2. Anything still unresolved may be a bare Stamp id (StampCard path).
  const unresolvedIds = catalogIds.filter((id) => !catalog.has(id));
  if (unresolvedIds.length > 0) {
    const stampPlaceholders = unresolvedIds.map(() => "?").join(", ");
    collectCatalogRows(
      await runQuery(
        // Deliberately NOT selecting Stamp.currency: that column is the
        // face-value currency, not marketPriceUsd's currency. USD is
        // forced by `collectCatalogRows(..., "usd")` below instead.
        `SELECT id AS id, COALESCE(nameEs, nameEn) AS title, scottNumber AS scott,
                marketPriceUsd AS price
         FROM Stamp WHERE id IN (${stampPlaceholders})`,
        unresolvedIds
      ),
      catalog,
      "usd"
    );
  }

  for (const catalogId of catalogIds) {
    if (!catalog.has(catalogId)) {
      throw new OrderValidationError(
        `'${catalogId}' has no usable catalog price (unknown or inactive product, unknown stamp, ` +
        `or the price column is null/invalid)`
      );
    }
  }

  // Every line's currency must be known AND identical before anything is
  // priced. Refusing loudly here is the whole point: a wrong number
  // silently written against a real payment is the failure mode this
  // exists to prevent, so an unknown or mixed currency rejects the WHOLE
  // order rather than guessing, dropping the line, or picking a "majority"
  // currency.
  const unknownCurrencyIds = catalogIds.filter((id) => catalog.get(id)!.currency === null);
  if (unknownCurrencyIds.length > 0) {
    throw new OrderValidationError(
      `'${unknownCurrencyIds.join("', '")}' has no declared currency (Product.currency is NULL). ` +
      `Refusing to price an order with an unknown currency rather than assuming one.`
    );
  }

  const distinctCurrencies = new Set(catalogIds.map((id) => catalog.get(id)!.currency));
  if (distinctCurrencies.size > 1) {
    throw new OrderValidationError(
      `Order mixes items priced in different currencies (${Array.from(distinctCurrencies).join(", ")}). ` +
      `A single order must be denominated in exactly one currency; there is no exchange rate to reconcile them.`
    );
  }
  const currency = distinctCurrencies.values().next().value as OrderCurrency;

  const shippingCost = resolveShippingCost(currency);
  if (shippingCost === null) {
    throw new OrderValidationError(
      `No shipping fee is configured for currency '${currency}'. Refusing to persist an order whose ` +
      `shipping cost cannot be reconciled with its line currency rather than guessing or converting one.`
    );
  }

  // Note the absence of `...item`: nothing the caller wrote survives except
  // the id and the quantity. `title`/`scott` are what fulfilment and dispute
  // handling later read as the description of what was sold, so they are
  // server-derived exactly like the price and currency.
  const pricedItems: OrderItem[] = items.map((item) => {
    const entry = catalog.get(item.id)!;
    return {
      id: item.id,
      title: entry.title,
      price: entry.price,
      quantity: item.quantity,
      scott: entry.scott,
      currency: entry.currency,
    };
  });

  const subtotal = roundCurrency(
    pricedItems.reduce((acc, item) => acc + item.price * item.quantity, 0)
  );
  const totalAmount = roundCurrency(subtotal + shippingCost);

  return { items: pricedItems, subtotal, shippingCost, totalAmount, currency };
}

function mapOrderRow(row: any): Omit<OrderRecord, "itemsCount" | "items"> {
  return {
    id: row.id,
    date: row.created_at,
    totalAmount: row.total_amount,
    currency: row.currency,
    status: row.status,
    shippingDetails: {
      fullName: row.shipping_full_name,
      address: row.shipping_address,
      city: row.shipping_city,
      postalCode: row.shipping_postal_code,
      phone: row.shipping_phone,
    },
    paymentMethod: row.payment_method,
  };
}

function mapItemRow(row: any): OrderItem {
  return {
    id: row.stamp_id,
    title: row.title,
    price: row.price,
    quantity: row.quantity,
    scott: row.scott ?? undefined,
    currency: row.currency,
  };
}

/**
 * Creates an Order row plus its OrderItem rows for the given (already
 * verified) userId. The caller is responsible for never deriving `userId`
 * from request body input — only from a verified session.
 *
 * Every monetary value is re-derived from the catalog by `priceOrder`; the
 * payload's own `price`/`subtotal`/`shippingCost`/`totalAmount` fields are
 * never persisted.
 */
export async function createOrder(
  userId: string,
  payload: CreateOrderPayload,
  // The route prices the order first so it can show the buyer the real total
  // before anything is written (see POST /api/orders). Passing that same
  // PricedOrder back in guarantees the number the buyer confirmed is the
  // number persisted, instead of re-reading the catalog a second time and
  // possibly getting a third value.
  prePriced?: PricedOrder
): Promise<OrderRecord> {
  const id = `ORD-${Date.now()}-${Math.floor(10000 + Math.random() * 90000)}`;

  const priced = prePriced ?? (await priceOrder(payload));

  // ONE batch: the Order row and every OrderItem row land together or not at
  // all. Writing them as separate awaited statements used to allow a failure
  // partway through the items to leave an orphaned order behind, which the
  // buyer was simultaneously told had failed.
  const statements = [
    {
      sql: `INSERT INTO "Order" (id, user_id, status, total_amount, currency, payment_method,
       shipping_full_name, shipping_address, shipping_city, shipping_postal_code, shipping_phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
      params: [
        id,
        userId,
        "Pending",
        priced.totalAmount,
        priced.currency,
        payload.paymentMethod,
        payload.shippingDetails.fullName,
        payload.shippingDetails.address,
        payload.shippingDetails.city,
        payload.shippingDetails.postalCode,
        payload.shippingDetails.phone,
      ],
    },
    ...priced.items.map((item) => ({
      sql: `INSERT INTO OrderItem (order_id, stamp_id, title, price, currency, quantity, scott)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, item.id, item.title, item.price, item.currency, item.quantity, item.scott ?? null],
    })),
  ];

  let batchResults: any[][];
  try {
    batchResults = await runBatch(statements);
  } catch (err) {
    // A D1/infrastructure failure, NOT a rejected payload. The batch is
    // transactional, so nothing was persisted — say so, because the buyer is
    // about to be told the order failed and that must be the truth.
    console.error(
      `${LOG_PREFIX} order write failed and was rolled back (no partial order persisted) ` +
      `— user ${userId}, order ${id}, ${priced.items.length} item(s)`,
      err
    );
    throw err;
  }

  // The batch COMMITTED — control only reaches here if runBatch did not
  // throw. Reading the RETURNING row is therefore a convenience, not a
  // success condition: if D1 surfaces no rows for the first statement,
  // `mapOrderRow(undefined)` used to throw AFTER the money landed, the route
  // answered 400, and checkout told the buyer the order failed without
  // clearing the cart — inviting a retry that creates a duplicate order.
  // Every value below is one we ourselves just wrote, so the record can be
  // reconstructed without another read.
  const orderRow = batchResults?.[0]?.[0];
  if (!orderRow) {
    console.warn(
      `${LOG_PREFIX} order ${id} COMMITTED for user ${userId} but the batch surfaced no ` +
      `RETURNING row; reporting success from the written values (created_at is approximate)`
    );
  }

  return {
    ...(orderRow
      ? mapOrderRow(orderRow)
      : {
          id,
          date: new Date().toISOString(),
          totalAmount: priced.totalAmount,
          currency: priced.currency,
          status: "Pending" as const,
          shippingDetails: payload.shippingDetails,
          paymentMethod: payload.paymentMethod,
        }),
    itemsCount: priced.items.reduce((acc, item) => acc + item.quantity, 0),
    items: priced.items,
  };
}

// A single customer cannot be allowed to turn their own history into an
// unbounded read: on Workers every statement is a subrequest, so an
// unbounded per-order item query eventually makes the endpoint fail
// permanently for exactly the customers who bought the most. Same ceiling
// src/lib/db/collection.ts uses for the equivalent per-user listing.
const MAX_ORDERS_PER_USER = 5000;

/**
 * Lists the given user's own orders, newest first, with their items
 * attached. Exactly two statements regardless of history size: the orders,
 * then every item belonging to that user's orders in one joined read.
 */
export async function getUserOrders(userId: string): Promise<OrderRecord[]> {
  const orderRows = await runQuery(
    `SELECT * FROM "Order" WHERE user_id = ? ORDER BY created_at DESC LIMIT ${MAX_ORDERS_PER_USER}`,
    [userId]
  );

  if (orderRows.length === 0) return [];

  // Joined on user_id rather than an `IN (...)` over up to 5000 order ids,
  // which would blow past D1's bind-parameter ceiling.
  const itemRows = await runQuery(
    `SELECT oi.* FROM OrderItem oi
     JOIN "Order" o ON o.id = oi.order_id
     WHERE o.user_id = ?`,
    [userId]
  );

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const row of itemRows) {
    const bucket = itemsByOrder.get(row.order_id);
    if (bucket) bucket.push(mapItemRow(row));
    else itemsByOrder.set(row.order_id, [mapItemRow(row)]);
  }

  return orderRows.map((orderRow) => {
    const items = itemsByOrder.get(orderRow.id) ?? [];
    return {
      ...mapOrderRow(orderRow),
      itemsCount: items.reduce((acc, item) => acc + item.quantity, 0),
      items,
    };
  });
}
