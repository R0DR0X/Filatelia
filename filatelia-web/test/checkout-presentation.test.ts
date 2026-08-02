import { describe, it, expect } from "vitest";
import { formatOrderDate, formatOrderMoney, interpretOrderResponse } from "../src/lib/checkout";

// `Product` rows hold prices in MIXED, unlabelled currencies — some soles,
// some dollars — with no column to tell them apart. A previous pass
// blanket-relabelled every order-path amount `US$` on the incorrect
// assumption that everything was dollars; that assumption is now known
// false, so `formatOrderMoney` takes the currency explicitly instead of
// assuming one. See src/lib/orderCurrency.ts.
describe("order currency", () => {
  it("labels a USD amount with the US$ symbol", () => {
    expect(formatOrderMoney(235, "USD")).toBe("US$ 235.00");
    expect(formatOrderMoney(0, "USD")).toBe("US$ 0.00");
    expect(formatOrderMoney(1.5, "USD")).toBe("US$ 1.50");
    expect(formatOrderMoney(234.567, "USD")).toBe("US$ 234.57");
  });

  it("labels a PEN amount with the S/. symbol, never US$", () => {
    expect(formatOrderMoney(15, "PEN")).toBe("S/. 15.00");
    expect(formatOrderMoney(15, "PEN")).not.toMatch(/US\$/);
  });

  it("never shows a numeric amount for an unresolved currency", () => {
    expect(formatOrderMoney(15, null)).not.toMatch(/15/);
    expect(formatOrderMoney(15, undefined)).not.toMatch(/US\$|S\/\./);
  });
});

// FIX 10: `created_at DATETIME DEFAULT CURRENT_TIMESTAMP` arrives as
// "2026-08-02 15:04:05" (UTC, space separated), which `new Date(...)` parses
// inconsistently and which the profile table used to render raw.
describe("formatOrderDate", () => {
  it("formats a SQLite CURRENT_TIMESTAMP value as a locale date", () => {
    const expected = new Date(Date.UTC(2026, 7, 2, 15, 4, 5)).toLocaleDateString("es-PE");
    expect(formatOrderDate("2026-08-02 15:04:05", "es-PE")).toBe(expected);
  });

  it("formats an ISO timestamp the same way", () => {
    const expected = new Date("2026-08-02T15:04:05.000Z").toLocaleDateString("es-PE");
    expect(formatOrderDate("2026-08-02T15:04:05.000Z", "es-PE")).toBe(expected);
  });

  it("falls back to the raw value rather than rendering 'Invalid Date'", () => {
    expect(formatOrderDate("no es una fecha", "es-PE")).toBe("no es una fecha");
    expect(formatOrderDate("", "es-PE")).toBe("");
  });
});

// FIX 2 / FIX 3: the buyer must never read a raw server string, and must
// never be told an order succeeded (or failed) inaccurately.
describe("interpretOrderResponse", () => {
  it("reports a created order with the total AND currency the SERVER persisted", () => {
    const outcome = interpretOrderResponse(201, {
      success: true,
      orderId: "ORD-1",
      subtotal: 150,
      shippingCost: 15,
      totalAmount: 165,
      currency: "USD",
    });
    expect(outcome).toEqual({ kind: "created", orderId: "ORD-1", totalAmount: 165, currency: "USD" });
  });

  it("turns a 401 into Spanish copy, never the raw 'Unauthenticated'", () => {
    const outcome = interpretOrderResponse(401, { success: false, error: "Unauthenticated" });
    if (outcome.kind !== "unauthenticated") throw new Error(`expected unauthenticated, got ${outcome.kind}`);
    expect(outcome.message).not.toMatch(/Unauthenticated/);
    expect(outcome.message).toMatch(/sesión/i);
  });

  it("turns a price change into Spanish copy showing the new total in its actual currency", () => {
    const outcome = interpretOrderResponse(409, {
      success: false,
      code: "price_changed",
      subtotal: 200,
      shippingCost: 15,
      totalAmount: 215,
      currency: "USD",
      items: [{ id: "prod-01", title: "Perú 1857", price: 200, quantity: 1, currency: "USD" }],
    });

    expect(outcome.kind).toBe("price-changed");
    if (outcome.kind !== "price-changed") throw new Error("unreachable");
    expect(outcome.totalAmount).toBe(215);
    expect(outcome.currency).toBe("USD");
    expect(outcome.items).toHaveLength(1);
    expect(outcome.message).toMatch(/US\$ 215\.00/);
    expect(outcome.message).toMatch(/precio/i);
  });

  it("turns a PEN price change into Spanish copy with the S/. symbol, never US$", () => {
    const outcome = interpretOrderResponse(409, {
      success: false,
      code: "price_changed",
      subtotal: 100,
      shippingCost: 0,
      totalAmount: 100,
      currency: "PEN",
      items: [{ id: "prod-02", title: "Perú 1858", price: 100, quantity: 1, currency: "PEN" }],
    });

    if (outcome.kind !== "price-changed") throw new Error("unreachable");
    expect(outcome.message).toMatch(/S\/\. 100\.00/);
    expect(outcome.message).not.toMatch(/US\$/);
  });

  it("never surfaces a raw server error string for any other failure", () => {
    const outcome = interpretOrderResponse(500, {
      success: false,
      error: "D1 binding 'DB' is unavailable; run `wrangler pages dev`",
    });
    if (outcome.kind !== "error") throw new Error(`expected error, got ${outcome.kind}`);
    expect(outcome.message).not.toMatch(/wrangler/i);
    expect(outcome.message).not.toMatch(/D1/);
    expect(outcome.message).toMatch(/pedido/i);
  });

  it("treats a 2xx without a usable order id as a failure, not a fake success", () => {
    const outcome = interpretOrderResponse(201, { success: true });
    expect(outcome.kind).toBe("error");
  });
});
