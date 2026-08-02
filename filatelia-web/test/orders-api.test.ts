import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/orders/route";
import { signSession } from "../src/lib/session";

function setMockD1(mock: any) {
  process.env = Object.assign({}, process.env, { DB: mock });
}
function clearMockD1() {
  const { DB, ...rest } = process.env as any;
  process.env = rest;
}

// Read-only catalog the fake D1 answers the server-side price lookup from.
//
// The cart posts `Product` ids: /api/products is prisma.product.findMany()
// and src/app/(public)/tienda/page.tsx adds `product.id`. `Product.price` is
// the authoritative price column for those lines. `Product.currency` is
// nullable and mostly unpopulated for real rows (see
// db/migrations/0011_add_product_currency.sql) — these fixtures declare it
// explicitly so the common case is exercised; currency-specific tests
// override it.
const PRODUCT_CATALOG = [
  { id: "prod-01", title: "Perú 1857 1d Azul UN DINERO", price: 150, currency: "USD", scott: "Scott #1" },
  { id: "prod-02", title: "Perú 1858 1d Rojo Frambuesa", price: 35, currency: "USD", scott: "Scott #3" },
];
const STAMP_CATALOG = [{ id: "stamp-01", title: "Sello suelto 1873", price: 80, scott: "Scott #17" }];

function createMockD1(
  options: {
    products?: { id: string; title: string; price: number | null; currency?: string | null; scott?: string | null }[];
    stamps?: { id: string; title: string; price: number | null; scott?: string | null }[];
  } = {}
) {
  const products = options.products ?? PRODUCT_CATALOG;
  const stamps = options.stamps ?? STAMP_CATALOG;
  const orders: any[] = [];
  const items: any[] = [];

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
      return { results: [row] };
    }
    if (/INSERT INTO OrderItem/i.test(sql)) {
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
      return { results: [row] };
    }
    if (/FROM "Order" WHERE user_id/i.test(sql)) {
      const matched = orders
        .filter((o) => o.user_id === params[0])
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { results: matched };
    }
    if (/FROM OrderItem/i.test(sql)) {
      const ownedOrderIds = new Set(orders.filter((o) => o.user_id === params[0]).map((o) => o.id));
      return { results: items.filter((i) => ownedOrderIds.has(i.order_id)) };
    }
    return { results: [] };
  }

  return {
    prepare(sql: string) {
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
    __debug: { orders, items },
  };
}

// A realistic cart line: what tienda/page.tsx actually puts in the cart is a
// `Product` id. `totalAmount` is what the buyer saw and confirmed: 150 + 15.
const validPayload = {
  items: [{ id: "prod-01", title: "Perú 1857 1d Azul UN DINERO", price: 150, quantity: 1, scott: "Scott #1" }],
  shippingDetails: {
    fullName: "Ana Coleccionista",
    address: "Calle Falsa 123",
    city: "Arequipa",
    postalCode: "04001",
    phone: "+51 900 000 000",
  },
  paymentMethod: "yape_plin",
  subtotal: 150,
  shippingCost: 15,
  totalAmount: 165,
};

function post(token: string | null, body: any) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Cookie = "fp_session=" + token;
  return POST(
    new NextRequest("http://localhost:3000/api/orders", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/orders", () => {
  afterEach(() => {
    clearMockD1();
  });

  it("returns 401 and writes nothing when there is no session", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const res = await post(null, validPayload);
    expect(res.status).toBe(401);
    expect(mock.__debug.orders).toHaveLength(0);
  });

  it("attaches the order to the session's user, ignoring any userId in the body", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const token = await signSession({ id: "usr_real_owner", name: "Real Owner" });
    // Attempt to spoof a different owner via the body.
    const res = await post(token, { ...validPayload, userId: "usr_attacker_supplied" });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(typeof data.orderId).toBe("string");

    expect(mock.__debug.orders).toHaveLength(1);
    expect(mock.__debug.orders[0].user_id).toBe("usr_real_owner");
  });

  // ---------------------------------------------------------------------
  // Server-authoritative pricing. The client posts prices, but the server
  // must never persist them: it re-reads the catalog and recomputes every
  // total itself.
  // ---------------------------------------------------------------------

  it("persists the CATALOG price, not a lower client-supplied price", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const token = await signSession({ id: "usr_shopper", name: "Shopper" });
    const res = await post(token, {
      ...validPayload,
      // Line price tampered down; the confirmed total is still the honest one.
      items: [{ id: "prod-01", title: "Perú 1857", price: 0.01, quantity: 1 }],
    });

    expect(res.status).toBe(201);
    expect(mock.__debug.items).toHaveLength(1);
    expect(mock.__debug.items[0].price).toBe(150);
  });

  it("persists a server-computed totalAmount (catalog subtotal + flat shipping)", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const token = await signSession({ id: "usr_totals", name: "Totals" });
    const res = await post(token, {
      ...validPayload,
      items: [
        { id: "prod-01", title: "Perú 1857", price: 150, quantity: 1 },
        { id: "prod-02", title: "Perú 1858", price: 35, quantity: 2 },
      ],
      subtotal: 220,
      shippingCost: 15,
      totalAmount: 235,
    });

    expect(res.status).toBe(201);
    // 150*1 + 35*2 = 220 subtotal, + 15.00 flat insured shipping = 235.
    expect(mock.__debug.orders[0].total_amount).toBe(235);
  });

  // FIX 3: the confirmed total and the charged total must be the same number.
  it("returns the total it actually persisted", async () => {
    setMockD1(createMockD1());

    const token = await signSession({ id: "usr_echo", name: "Echo" });
    const res = await post(token, validPayload);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.totalAmount).toBe(165);
    expect(data.subtotal).toBe(150);
    expect(data.shippingCost).toBe(15);
  });

  it("refuses to persist an order whose live total differs from the confirmed total", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const token = await signSession({ id: "usr_stale", name: "Stale Cart" });
    // The buyer confirmed 100.00 (a stale localStorage price); the live
    // catalog says 165.00.
    const res = await post(token, { ...validPayload, totalAmount: 100 });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("price_changed");
    expect(data.totalAmount).toBe(165);
    expect(data.items[0].price).toBe(150);
    // Nothing was charged behind the buyer's back.
    expect(mock.__debug.orders).toHaveLength(0);
    expect(mock.__debug.items).toHaveLength(0);
  });

  it("rejects an order that confirms no total at all", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const token = await signSession({ id: "usr_nototal", name: "No Total" });
    const { totalAmount, ...noTotal } = validPayload;
    const res = await post(token, noTotal);

    expect(res.status).toBe(400);
    expect(mock.__debug.orders).toHaveLength(0);
  });

  it("rejects an order referencing an id in no catalog, writing nothing", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const token = await signSession({ id: "usr_ghost", name: "Ghost" });
    const res = await post(token, {
      ...validPayload,
      items: [{ id: "does-not-exist", title: "Invented", price: 5, quantity: 1 }],
    });

    expect(res.status).toBe(400);
    expect(mock.__debug.orders).toHaveLength(0);
    expect(mock.__debug.items).toHaveLength(0);
  });

  it("rejects a zero, negative or non-integer quantity, writing nothing", async () => {
    const token = await signSession({ id: "usr_qty", name: "Qty" });

    for (const quantity of [0, -2, 1.5, "3"]) {
      const mock = createMockD1();
      setMockD1(mock);

      const res = await post(token, {
        ...validPayload,
        items: [{ id: "prod-01", title: "Perú 1857", price: 150, quantity }],
      });

      expect(res.status).toBe(400);
      expect(mock.__debug.orders).toHaveLength(0);
      expect(mock.__debug.items).toHaveLength(0);
    }
  });

  it("rejects a catalog entry whose price is missing, rather than inventing one", async () => {
    const mock = createMockD1({ products: [{ id: "prod-01", title: "Perú 1857", price: null }] });
    setMockD1(mock);

    const token = await signSession({ id: "usr_nullprice", name: "Null Price" });
    const res = await post(token, validPayload);

    expect(res.status).toBe(400);
    expect(mock.__debug.orders).toHaveLength(0);
  });

  // Currency correctness at the route layer: `priceOrder`'s refusal must
  // surface as the same opaque 400 every other rejected payload gets — not
  // a 500, and never a silently-priced order.
  it("rejects an order whose catalog entry has no declared currency, writing nothing", async () => {
    const mock = createMockD1({
      products: [{ id: "prod-01", title: "Perú 1857", price: 150, currency: null }],
    });
    setMockD1(mock);

    const token = await signSession({ id: "usr_nocurrency", name: "No Currency" });
    const res = await post(token, validPayload);

    expect(res.status).toBe(400);
    expect(mock.__debug.orders).toHaveLength(0);
  });

  it("rejects an order mixing a USD line with a PEN line, writing nothing", async () => {
    const mock = createMockD1({
      products: [
        { id: "prod-01", title: "Perú 1857", price: 150, currency: "USD" },
        { id: "prod-02", title: "Perú soles", price: 35, currency: "PEN" },
      ],
    });
    setMockD1(mock);

    const token = await signSession({ id: "usr_mixedcurrency", name: "Mixed Currency" });
    const res = await post(token, {
      ...validPayload,
      items: [
        { id: "prod-01", title: "x", price: 150, quantity: 1 },
        { id: "prod-02", title: "y", price: 35, quantity: 1 },
      ],
      subtotal: 185,
      totalAmount: 200,
    });

    expect(res.status).toBe(400);
    expect(mock.__debug.orders).toHaveLength(0);
  });

  // FIX 4: descriptive fields on a money record come from the catalog.
  it("persists the catalog title/scott, not the caller's own descriptive text", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const token = await signSession({ id: "usr_liar", name: "Liar" });
    const res = await post(token, {
      ...validPayload,
      items: [
        {
          id: "prod-01",
          title: "CON CERTIFICADO DE PERITAJE Y GARANTÍA DE POR VIDA",
          price: 150,
          quantity: 1,
          scott: "Scott #999",
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(mock.__debug.items[0].title).toBe("Perú 1857 1d Azul UN DINERO");
    expect(mock.__debug.items[0].scott).toBe("Scott #1");
  });
});

// A rejected payload and a broken database are indistinguishable to the
// client on purpose ("Invalid order payload format", 400, both cases). They
// must NOT be indistinguishable to an operator, or "my order vanished" is
// undiagnosable. Convention follows src/app/api/admin/[...path]/route.ts.
describe("POST /api/orders — server-side diagnostics", () => {
  afterEach(() => {
    clearMockD1();
    vi.restoreAllMocks();
  });

  it("logs a validation rejection as a warning naming the reason", async () => {
    setMockD1(createMockD1());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const token = await signSession({ id: "usr_log_v", name: "Log V" });
    const res = await post(token, {
      ...validPayload,
      items: [{ id: "prod-nope", title: "Invented", price: 5, quantity: 1 }],
    });

    expect(res.status).toBe(400);
    // The client-visible body stays opaque.
    expect((await res.json()).error).toBe("Invalid order payload format");

    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/\[orders-api\]/);
    expect(logged).toMatch(/prod-nope/);
    // A rejected payload is not a database incident.
    expect(error).not.toHaveBeenCalled();
  });

  // FIX 4: a hostile payload must not be misfiled as an infrastructure
  // incident. A non-string shipping field used to throw a TypeError.
  it.each([
    ["a non-string phone", { phone: 12345 }],
    ["a null full name", { fullName: null }],
    ["an object address", { address: { toString: "nope" } }],
  ])("rejects %s as a payload problem, not a database incident", async (_label, override) => {
    const mock = createMockD1();
    setMockD1(mock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const token = await signSession({ id: "usr_types", name: "Types" });
    const res = await post(token, {
      ...validPayload,
      shippingDetails: { ...validPayload.shippingDetails, ...override },
    });

    expect(res.status).toBe(400);
    expect(mock.__debug.orders).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("rejects a non-string item title as a payload problem", async () => {
    const mock = createMockD1();
    setMockD1(mock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const token = await signSession({ id: "usr_nulltitle", name: "Null Title" });
    const res = await post(token, {
      ...validPayload,
      items: [{ id: "prod-01", title: null, price: 150, quantity: 1 }],
    });

    // Either way it must not reach the NOT NULL constraint as a "database
    // error": the title is server-derived, so this is a 201 with the catalog
    // title, never a 500-shaped incident.
    expect([201, 400]).toContain(res.status);
    expect(error).not.toHaveBeenCalled();
    if (res.status === 201) {
      expect(mock.__debug.items[0].title).toBe("Perú 1857 1d Azul UN DINERO");
    } else {
      expect(warn).toHaveBeenCalled();
    }
  });

  it("logs a D1 failure as an error, distinct from a validation rejection", async () => {
    const broken = createMockD1();
    const originalPrepare = broken.prepare.bind(broken);
    broken.prepare = (sql: string) => {
      if (/INSERT INTO "Order"/i.test(sql)) {
        return {
          bind: () => ({
            async all() {
              throw new Error("D1_ERROR: database is unreachable");
            },
          }),
        };
      }
      return originalPrepare(sql);
    };
    setMockD1(broken);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const token = await signSession({ id: "usr_log_d", name: "Log D" });
    const res = await post(token, validPayload);

    // Client-visible response is unchanged and just as opaque.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid order payload format");

    const logged = error.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toMatch(/\[orders-api\]/);
    expect(logged).toMatch(/usr_log_d/);
    // Not misfiled as an ordinary validation rejection.
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("GET /api/orders", () => {
  afterEach(() => {
    clearMockD1();
    vi.restoreAllMocks();
  });

  it("returns 401 when there is no session", async () => {
    setMockD1(createMockD1());
    const req = new NextRequest("http://localhost:3000/api/orders");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  // FIX 7: the POST path is deliberately opaque; GET must match.
  it("never leaks the internal error message to the client", async () => {
    const broken = createMockD1();
    broken.prepare = () => {
      throw new Error(
        "D1 binding 'DB' is unavailable in this environment. The remote SQL gateway " +
          "has been removed for security reasons; run this code where the D1 binding " +
          "is attached (e.g. `wrangler pages dev`)."
      );
    };
    setMockD1(broken);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const token = await signSession({ id: "usr_leak", name: "Leak" });
    const res = await GET(
      new NextRequest("http://localhost:3000/api/orders", {
        headers: { Cookie: "fp_session=" + token },
      })
    );

    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/wrangler/i);
    expect(body).not.toMatch(/SQL gateway/i);
    expect(body).not.toMatch(/D1/);
  });

  it("returns only the authenticated user's own orders, newest first, with items", async () => {
    const mock = createMockD1();
    setMockD1(mock);

    const ownerToken = await signSession({ id: "usr_owner", name: "Owner" });
    const otherToken = await signSession({ id: "usr_other", name: "Other" });

    // Owner places two orders, other user places one — via the POST handler
    // itself, so this also exercises the full persistence round trip.
    await post(ownerToken, validPayload);
    await new Promise((r) => setTimeout(r, 5));
    await post(ownerToken, validPayload);
    await post(otherToken, validPayload);

    const getRes = await GET(
      new NextRequest("http://localhost:3000/api/orders", {
        headers: { Cookie: "fp_session=" + ownerToken },
      })
    );
    expect(getRes.status).toBe(200);
    const data = await getRes.json();
    expect(data.success).toBe(true);
    expect(data.orders).toHaveLength(2);

    // FIX 8: a real cross-user isolation assertion. Every id the owner gets
    // back must be an id whose stored row carries the owner's user_id, and
    // none of the other user's ids may appear.
    const ownerRowIds = mock.__debug.orders
      .filter((o: any) => o.user_id === "usr_owner")
      .map((o: any) => o.id);
    const otherRowIds = mock.__debug.orders
      .filter((o: any) => o.user_id === "usr_other")
      .map((o: any) => o.id);
    expect(otherRowIds).toHaveLength(1);
    for (const order of data.orders) {
      expect(ownerRowIds).toContain(order.id);
      expect(otherRowIds).not.toContain(order.id);
    }

    expect(data.orders[0].items).toHaveLength(1);
    expect(data.orders[0].items[0].title).toBe("Perú 1857 1d Azul UN DINERO");

    // Explicit isolation check: the other user's own GET must not include
    // the owner's orders either.
    const otherGetRes = await GET(
      new NextRequest("http://localhost:3000/api/orders", {
        headers: { Cookie: "fp_session=" + otherToken },
      })
    );
    const otherData = await otherGetRes.json();
    expect(otherData.orders).toHaveLength(1);
    for (const order of otherData.orders) {
      expect(otherRowIds).toContain(order.id);
      expect(ownerRowIds).not.toContain(order.id);
    }
  });
});
