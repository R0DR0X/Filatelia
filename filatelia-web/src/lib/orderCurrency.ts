// Single source of truth for ORDER-PATH currency handling. Shared by
// src/lib/db/orders.ts (server, D1-backed) and src/lib/checkout.ts
// (client-facing formatting), so both sides refuse the same way instead of
// drifting.
//
// WHY THIS FILE EXISTS: `Product` rows hold prices in mixed, unlabelled
// currencies (some soles, some dollars, no column to tell them apart —
// see db/migrations/0011_add_product_currency.sql). `Stamp.marketPriceUsd`
// is unambiguously USD by its own column name. There is no exchange rate
// anywhere in this codebase and none is invented here: an amount whose
// currency cannot be established is treated as UNKNOWN, never defaulted.

export type OrderCurrency = "USD" | "PEN";

export const CURRENCY_SYMBOLS: Record<OrderCurrency, string> = {
  USD: "US$",
  PEN: "S/.",
};

export function isKnownCurrency(value: unknown): value is OrderCurrency {
  return value === "USD" || value === "PEN";
}

/**
 * Renders an amount with its currency's symbol. Given anything other than
 * exactly "USD" or "PEN" it renders NO numeric amount at all — showing a
 * number next to a currency we cannot vouch for is worse than showing
 * nothing, because a number silently implies a currency.
 */
export function formatOrderMoney(amount: number, currency: unknown): string {
  if (!isKnownCurrency(currency)) {
    return "Precio no disponible (moneda no registrada)";
  }
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${CURRENCY_SYMBOLS[currency]} ${safe.toFixed(2)}`;
}

/**
 * Flat shipping fee PER CURRENCY. Only USD has a configured value today —
 * there is no verified PEN shipping fee anywhere in this codebase, and
 * inventing one (or converting the USD figure with a made-up exchange rate)
 * would be exactly the kind of guess this change exists to stop. A currency
 * with no entry here has no shipping fee, full stop; `resolveShippingCost`
 * returns null rather than 0 or a converted figure so callers cannot
 * mistake "not configured" for "free shipping".
 */
const SHIPPING_COST_BY_CURRENCY: Partial<Record<OrderCurrency, number>> = {
  USD: 15.0,
};

export function resolveShippingCost(currency: OrderCurrency): number | null {
  return SHIPPING_COST_BY_CURRENCY[currency] ?? null;
}

export interface CartCurrencyLine {
  price: number;
  quantity: number;
  currency?: string | null;
}

export type CartCurrencySummary =
  | { ok: true; currency: OrderCurrency | null; subtotal: number }
  | { ok: false; reason: "unknown"; message: string }
  | { ok: false; reason: "mixed"; message: string };

/**
 * Reduces a cart to a single currency + subtotal, or explains in Spanish why
 * it cannot. Never averages, converts or picks a "majority" currency — one
 * unresolved or mismatched line is enough to refuse the whole cart, because
 * a wrong total recorded against a real payment is the failure this exists
 * to prevent.
 */
export function summarizeCartCurrency(items: CartCurrencyLine[]): CartCurrencySummary {
  if (items.length === 0) {
    return { ok: true, currency: null, subtotal: 0 };
  }

  const currencies = new Set<OrderCurrency>();
  for (const item of items) {
    if (!isKnownCurrency(item.currency)) {
      return {
        ok: false,
        reason: "unknown",
        message:
          "Uno o más artículos de tu carrito no tienen una moneda registrada en el catálogo. " +
          "No podemos calcular un total confiable hasta que se corrija en el catálogo: quita ese " +
          "artículo del carrito o contáctanos antes de continuar.",
      };
    }
    currencies.add(item.currency);
  }

  if (currencies.size > 1) {
    const symbols = Array.from(currencies)
      .map((c) => CURRENCY_SYMBOLS[c])
      .join(" y ");
    return {
      ok: false,
      reason: "mixed",
      message:
        `Tu carrito combina artículos en distintas monedas (${symbols}). No podemos sumar ` +
        `montos en monedas distintas en un mismo pedido: separa la compra por moneda o quita ` +
        `alguno de los artículos para continuar.`,
    };
  }

  const currency = currencies.values().next().value as OrderCurrency;
  const subtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  return { ok: true, currency, subtotal };
}
