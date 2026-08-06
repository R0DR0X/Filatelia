import { describe, it, expect } from "vitest";
import {
  CURRENCY_SYMBOLS,
  isKnownCurrency,
  formatOrderMoney,
  resolveShippingCost,
  summarizeCartCurrency,
} from "../src/lib/orderCurrency";

// The store's `Product` rows hold prices in MIXED currencies with no
// currency column of their own — this module is the single place that
// decides what counts as a "known" currency and refuses to guess when it
// isn't. See db/migrations/0011_add_product_currency.sql.
describe("isKnownCurrency", () => {
  it("accepts exactly PEN and USD", () => {
    expect(isKnownCurrency("USD")).toBe(true);
    expect(isKnownCurrency("PEN")).toBe(true);
  });

  it("rejects null, undefined, empty string and any other value", () => {
    expect(isKnownCurrency(null)).toBe(false);
    expect(isKnownCurrency(undefined)).toBe(false);
    expect(isKnownCurrency("")).toBe(false);
    expect(isKnownCurrency("usd")).toBe(false); // case-sensitive ISO code
    expect(isKnownCurrency("EUR")).toBe(false);
    expect(isKnownCurrency(123)).toBe(false);
  });
});

describe("formatOrderMoney", () => {
  it("renders a USD amount with the US$ symbol", () => {
    expect(formatOrderMoney(235, "USD")).toBe("US$ 235.00");
    expect(formatOrderMoney(1.5, "USD")).toBe("US$ 1.50");
    expect(formatOrderMoney(234.567, "USD")).toBe("US$ 234.57");
  });

  it("renders a PEN amount with the S/. symbol — never US$", () => {
    expect(formatOrderMoney(235, "PEN")).toBe("S/. 235.00");
    expect(formatOrderMoney(235, "PEN")).not.toMatch(/US\$/);
  });

  it("never invents a currency: an unknown currency renders no numeric amount", () => {
    for (const bad of [null, undefined, "EUR", ""]) {
      const rendered = formatOrderMoney(235, bad as any);
      expect(rendered).not.toMatch(/235/);
      expect(rendered).not.toMatch(/US\$|S\/\./);
    }
  });
});

describe("resolveShippingCost", () => {
  it("returns the configured flat fee for USD", () => {
    expect(resolveShippingCost("USD")).toBe(15.0);
  });

  it("returns null for a currency with no configured shipping fee, instead of guessing", () => {
    expect(resolveShippingCost("PEN")).toBeNull();
  });
});

describe("summarizeCartCurrency", () => {
  it("resolves a single-currency cart to its currency and subtotal", () => {
    const result = summarizeCartCurrency([
      { price: 150, quantity: 1, currency: "USD" },
      { price: 35, quantity: 2, currency: "USD" },
    ]);
    expect(result).toEqual({ ok: true, currency: "USD", subtotal: 220 });
  });

  it("refuses an empty cart's currency without claiming one", () => {
    expect(summarizeCartCurrency([])).toEqual({ ok: true, currency: null, subtotal: 0 });
  });

  it("refuses when any line's currency is unknown, in Spanish", () => {
    const result = summarizeCartCurrency([
      { price: 150, quantity: 1, currency: "USD" },
      { price: 90, quantity: 1, currency: null },
    ]);
    // `=== false`, not truthiness/negation on `result.ok` — this project's
    // `strict: false` tsconfig does not narrow a discriminated union through
    // a negated/thrown boolean-literal discriminant (verified against tsc
    // 5.9.3: `if (x.ok) throw ...` fails to narrow, `x.ok === false` does).
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe("unknown");
      expect(result.message).toMatch(/moneda/i);
    }
  });

  it("refuses when the cart mixes two known currencies, in Spanish", () => {
    const result = summarizeCartCurrency([
      { price: 150, quantity: 1, currency: "USD" },
      { price: 90, quantity: 1, currency: "PEN" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe("mixed");
      expect(result.message).toMatch(/moneda/i);
      expect(result.message).toMatch(/US\$/);
      expect(result.message).toMatch(/S\/\./);
    }
  });
});
