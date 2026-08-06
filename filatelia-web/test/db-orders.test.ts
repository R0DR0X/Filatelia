import { describe, it, expect, afterEach } from "vitest";
import { createOrder, getUserOrders } from "../src/lib/db/orders";
import { CreateOrderPayload } from "@/types/order";

// Same D1-mocking convention as test/db-users.test.ts: `process.env.DB = x`
// gets string-coerced by Node's real env object, so the mock must replace
// `process.env` wholesale.
function setMockD1(mock: any) {
  process.env = Object.assign({}, process.env, { DB: mock });
}
function clearMockD1() {
  const { DB, ...rest } = process.env as any;
  process.env = rest;
}

// Read-only catalog the fake answers the server-side price lookup from.
//
// `Product` is the table the cart actually draws from: /api/products calls
// prisma.product.findMany() and src/app/(public)/tienda/page.tsx puts
// `product.id` into the cart line. `Product.price` is therefore the
// authoritative price column for a real order line. `Product.currency` is
// nullable and unpopulated for most real rows today (see
// db/migrations/0011_add_product_currency.sql) — these fixtures declare it
// explicitly ('USD') so the base fixtures exercise the common, resolvable
// case; tests that need an undeclared or mixed currency override it below.
const PRODUCT_CATALOG = [
  { id: "prod-01", title: "Perú 1857 1d Azul UN DINERO", price: 150, currency: "USD", scott: "Scott #1" },
  { id: "prod-02", title: "Perú 1858 1d Rojo Frambuesa", price: 35, currency: "USD", scott: "Scott #3" },
];

// Secondary catalog: StampCard.tsx can also add a bare Stamp id to the cart
// (`isForSale && price`). Those lines price from `Stamp.marketPriceUsd`,
// which is USD by its own column name — `priceOrder` hardcodes that
// currency for Stamp-sourced lines rather than reading it from a column.
const STAMP_CATALOG = [{ id: "stamp-01", title: "Sello suelto 1873", price: 80, scott: "Scott #17" }];

/**
 * Minimal fake D1 binding backing the `Order`/`OrderItem` tables in memory,
 * plus read-only `Product` and `Stamp` price lookups. Supports the
 * prepare().bind().all() shape src/lib/db/orders.ts uses (via `runQuery`,
 * which always calls `.all()`, even for INSERT ... RETURNING) AND `batch()`,
 * which is how the order write is made atomic.
 */
function createMockD1(
  options: {
    products?: { id: string; title: string; price: number | null; currency?: string | null; scott?: string | null }[];
    stamps?: { id: string; title: string; price: number | null; scott?: string | null }[];
    failOnOrderItemIndex?: number;
    /** Simulates a D1 batch that commits but surfaces no RETURNING rows. */
    dropReturningRows?: boolean;
  } = {}
) {
  const products = options.products ?? PRODUCT_CATALOG;
  const stamps = options.stamps ?? STAMP_CATALOG;
  const orders: any[] = [];
  const items: any[] = [];
  const sqlLog: string[] = [];
  let orderItemInsertCount = 0;

  async function exec(sql: string, params: any[]) {
    if (/FROM Product/i.test(sql)) {
      return { results: products.filter((p) => params.includes(p.id)) };
    }
    if (/FROM Stamp WHERE id IN/i.test(sql)) {
      return { results: stamps.filter((s) => params.includes(s.id)) };
    }
    if (/INSERT INTO "Order"/i.test(sql)) {
      const row = {
        id: params[0],
        user_id: params[1],
        status: params[2],
        total_amount: params[3],
        currency: params[4],
        payment_method: params[5],
        shipping_full_name: params[6],
        shipping_address: params[7],
        shipping_city: params[8],
        shipping_postal_code: params[9],
        shipping_phone: params[10],
        created_at: new Date().toISOString(),
      };
      orders.push(row);
      return { results: options.dropReturningRows ? [] : [row] };
    }
    if (/INSERT INTO OrderItem/i.test(sql)) {
      const index = orderItemInsertCount++;
      if (options.failOnOrderItemIndex === index) {
        throw new Error("D1_ERROR: simulated failure inserting an OrderItem row");
      }
      const row = {
        id: items.length + 1,
        order_id: params[0],
        stamp_id: params[1],
        title: params[2],
        price: params[3],
        currency: params[4],
        quantity: params[5],
        scott: params[6],
      };
      items.push(row);
      return { results: options.dropReturningRows ? [] : [row] };
    }
    if (/FROM "Order" WHERE user_id/i.test(sql)) {
      const matched = orders
        .filter((o) => o.user_id === params[0])
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { results: matched };
    }
    if (/FROM OrderItem/i.test(sql)) {
      // Single joined read: every item belonging to this user's orders.
      const ownedOrderIds = new Set(orders.filter((o) => o.user_id === params[0]).map((o) => o.id));
      return { results: items.filter((i) => ownedOrderIds.has(i.order_id)) };
    }
    return { results: [] };
  }

  return {
    prepare(sql: string) {
      sqlLog.push(sql);
      return {
        bind(...params: any[]) {
          return { all: () => exec(sql, params) };
        },
      };
    },
    // D1's batch() runs its statements inside one implicit transaction:
    // either all of them land or none does. The fake mirrors that by
    // restoring the pre-batch snapshot when any statement throws.
    async batch(stmts: any[]) {
      const ordersSnapshot = orders.slice();
      const itemsSnapshot = items.slice();
      try {
        const out: any[] = [];
        for (const stmt of stmts) out.push(await stmt.all());
        return out;
      } catch (err) {
        orders.length = 0;
        orders.push(...ordersSnapshot);
        items.length = 0;
        items.push(...itemsSnapshot);
        throw err;
      }
    },
    __debug: { orders, items, sqlLog },
  };
}

const samplePayload: CreateOrderPayload = {
  items: [
    { id: "prod-01", title: "Perú 1857 1d Azul UN DINERO", price: 150, quantity: 1, scott: "Scott #1" },
    { id: "prod-02", title: "Perú 1858 1d Rojo Frambuesa", price: 35, quantity: 2, scott: "Scott #3" },
  ],
  shippingDetails: {
    fullName: "Ana Coleccionista",
    address: "Calle Falsa 123",
    city: "Arequipa",
    postalCode: "04001",
    phone: "+51 900 000 000",
  },
  paymentMethod: "yape_plin",
  subtotal: 220,
  shippingCost: 15,
  totalAmount: 235,
};

describe("db/orders persistence", () => {
  afterEach(() => {
    clearMockD1();
  });

  it("createOrder writes an Order row and OrderItem rows the caller can then read back", async () => {
    setMockD1(createMockD1());

    const created = await createOrder("usr_1", samplePayload);
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("Pending");
    // Server-derived: 150*1 + 35*2 = 220 catalog subtotal, plus the flat
    // 15.00 insured-shipping fee.
    expect(created.totalAmount).toBe(235);
    expect(created.itemsCount).toBe(3);
    expect(created.shippingDetails.city).toBe("Arequipa");
    // Both catalog lines declare 'USD' (see PRODUCT_CATALOG) — the order
    // and every one of its items must be persisted in that same currency.
    expect(created.currency).toBe("USD");
    expect(created.items.every((i) => i.currency === "USD")).toBe(true);

    const found = await getUserOrders("usr_1");
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(created.id);
    expect(found[0].currency).toBe("USD");
    expect(found[0].items).toHaveLength(2);
    expect(found[0].items[0].title).toBe("Perú 1857 1d Azul UN DINERO");
    expect(found[0].items[0].currency).toBe("USD");
  });

  // FIX 1: the cart carries `Product` ids, not `Stamp` ids.
  it("prices a Product-id cart line from the Product catalog", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const created = await createOrder("usr_prod", {
      ...samplePayload,
      items: [{ id: "prod-02", title: "irrelevant", price: 1, quantity: 2 }],
    });

    // 35 * 2 = 70 + 15 shipping.
    expect(created.totalAmount).toBe(85);
    expect(mock.__debug.items[0].price).toBe(35);
  });

  it("still prices a Stamp-id cart line (StampCard path) from Stamp.marketPriceUsd", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const created = await createOrder("usr_mixed", {
      ...samplePayload,
      items: [
        { id: "prod-01", title: "x", price: 1, quantity: 1 },
        { id: "stamp-01", title: "y", price: 1, quantity: 1 },
      ],
    });

    // 150 + 80 = 230 + 15.
    expect(created.totalAmount).toBe(245);
  });

  it("rejects an id that matches neither Product nor Stamp, writing nothing", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    await expect(
      createOrder("usr_ghost", {
        ...samplePayload,
        items: [{ id: "does-not-exist", title: "Invented", price: 5, quantity: 1 }],
      })
    ).rejects.toThrow();
    expect(mock.__debug.orders).toHaveLength(0);
  });

  // FIX 4: descriptive fields are money-record fields too.
  it("persists the CATALOG title and scott, never the caller's own text", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    await createOrder("usr_liar", {
      ...samplePayload,
      items: [
        {
          id: "prod-01",
          title: "CERTIFICADO DE AUTENTICIDAD INCLUIDO — garantía de por vida",
          price: 150,
          quantity: 1,
          scott: "Scott #999 (perito)",
        },
      ],
    });

    expect(mock.__debug.items).toHaveLength(1);
    expect(mock.__debug.items[0].title).toBe("Perú 1857 1d Azul UN DINERO");
    expect(mock.__debug.items[0].scott).toBe("Scott #1");
  });

  it("getUserOrders never returns another user's orders", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    await createOrder("usr_owner", samplePayload);
    await createOrder("usr_other", samplePayload);

    const ownerOrders = await getUserOrders("usr_owner");
    expect(ownerOrders).toHaveLength(1);
    // FIX 8: a real isolation assertion. Every returned id must belong to
    // the requesting user according to the underlying rows.
    const ownerRowIds = mock.__debug.orders
      .filter((o: any) => o.user_id === "usr_owner")
      .map((o: any) => o.id);
    const otherRowIds = mock.__debug.orders
      .filter((o: any) => o.user_id === "usr_other")
      .map((o: any) => o.id);
    expect(ownerOrders.map((o) => o.id).sort()).toEqual(ownerRowIds.slice().sort());
    for (const id of ownerOrders.map((o) => o.id)) {
      expect(otherRowIds).not.toContain(id);
    }

    const otherOrders = await getUserOrders("usr_other");
    expect(otherOrders.map((o) => o.id).sort()).toEqual(otherRowIds.slice().sort());
  });

  it("leaves NO order row when a write fails partway through the items", async () => {
    // The payload has two items. The second OrderItem insert fails, which is
    // exactly the case that used to leave an orphaned Order row carrying only
    // half its items while the buyer was told the order failed.
    const mock = createMockD1({ failOnOrderItemIndex: 1 });
    setMockD1(mock);

    await expect(createOrder("usr_1", samplePayload)).rejects.toThrow();

    expect(mock.__debug.orders).toHaveLength(0);
    expect(mock.__debug.items).toHaveLength(0);
    await expect(getUserOrders("usr_1")).resolves.toHaveLength(0);
  });

  // FIX 5: a committed batch that surfaces no RETURNING rows must NOT be
  // reported as a failure — the money already landed.
  it("succeeds when the committed batch surfaces no RETURNING row", async () => {
    const mock = createMockD1({ dropReturningRows: true });
    setMockD1(mock);

    const created = await createOrder("usr_no_returning", samplePayload);

    expect(mock.__debug.orders).toHaveLength(1);
    expect(created.id).toBe(mock.__debug.orders[0].id);
    expect(created.totalAmount).toBe(235);
    expect(created.status).toBe("Pending");
    expect(created.shippingDetails.city).toBe("Arequipa");
    expect(typeof created.date).toBe("string");
    expect(created.date).toBeTruthy();
  });

  // FIX 6: bounded, non-N+1 history read.
  it("reads the whole history with a bounded query and no per-order item query", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    await createOrder("usr_many", samplePayload);
    await createOrder("usr_many", samplePayload);
    await createOrder("usr_many", samplePayload);

    mock.__debug.sqlLog.length = 0;
    const found = await getUserOrders("usr_many");
    expect(found).toHaveLength(3);
    expect(found[0].items).toHaveLength(2);

    // One order query + one item query, no matter how many orders.
    expect(mock.__debug.sqlLog).toHaveLength(2);
    expect(mock.__debug.sqlLog[0]).toMatch(/LIMIT\s+5000/i);
  });

  it("getUserOrders returns newest first", async () => {
    setMockD1(createMockD1());

    const first = await createOrder("usr_1", samplePayload);
    // Ensure a distinguishable created_at ordering.
    await new Promise((r) => setTimeout(r, 5));
    const second = await createOrder("usr_1", samplePayload);

    const found = await getUserOrders("usr_1");
    expect(found[0].id).toBe(second.id);
    expect(found[1].id).toBe(first.id);
  });
});

// The store's `Product` rows hold prices in mixed, unlabelled currencies —
// this suite is the server-side refusal that keeps a wrong number from ever
// landing against a real payment. There is no exchange rate anywhere in
// this codebase; these tests assert REJECTION, not a guessed number.
describe("priceOrder — currency correctness", () => {
  afterEach(() => {
    clearMockD1();
  });

  it("rejects a Product line whose currency column is NULL, writing nothing", async () => {
    const mock = createMockD1({
      products: [{ id: "prod-01", title: "Perú 1857", price: 150, currency: null, scott: "Scott #1" }],
    });
    setMockD1(mock);

    await expect(
      createOrder("usr_unknown_currency", {
        ...samplePayload,
        items: [{ id: "prod-01", title: "x", price: 150, quantity: 1 }],
      })
    ).rejects.toThrow(/currency/i);
    expect(mock.__debug.orders).toHaveLength(0);
    expect(mock.__debug.items).toHaveLength(0);
  });

  it("rejects a cart mixing a PEN Product line with a USD Product line, writing nothing", async () => {
    const mock = createMockD1({
      products: [
        { id: "prod-01", title: "Perú 1857", price: 150, currency: "USD", scott: "Scott #1" },
        { id: "prod-03", title: "Perú soles", price: 50, currency: "PEN", scott: "Scott #9" },
      ],
    });
    setMockD1(mock);

    await expect(
      createOrder("usr_mixed_currency", {
        ...samplePayload,
        items: [
          { id: "prod-01", title: "x", price: 150, quantity: 1 },
          { id: "prod-03", title: "y", price: 50, quantity: 1 },
        ],
      })
    ).rejects.toThrow(/currency|moneda/i);
    expect(mock.__debug.orders).toHaveLength(0);
  });

  it("still forces the Stamp path to USD even when it has no currency column selected", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const created = await createOrder("usr_stamp_currency", {
      ...samplePayload,
      items: [{ id: "stamp-01", title: "y", price: 1, quantity: 1 }],
    });

    expect(created.currency).toBe("USD");
    expect(mock.__debug.items[0].currency).toBe("USD");
  });

  it("rejects an order priced in a currency with no configured shipping fee (PEN), writing nothing", async () => {
    const mock = createMockD1({
      products: [{ id: "prod-03", title: "Producto en soles", price: 50, currency: "PEN", scott: null }],
    });
    setMockD1(mock);

    await expect(
      createOrder("usr_pen_no_shipping", {
        ...samplePayload,
        items: [{ id: "prod-03", title: "x", price: 50, quantity: 1 }],
      })
    ).rejects.toThrow(/shipping|envío/i);
    expect(mock.__debug.orders).toHaveLength(0);
  });
});
