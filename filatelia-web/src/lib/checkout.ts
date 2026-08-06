// Presentation helpers for the ORDER path, kept out of the React components
// so they can be unit tested without a DOM (same split as
// src/lib/collectionControl.ts). Every user-facing string here is Spanish;
// the client must never render a raw server string.
import type { OrderItem } from "@/types/order";
import {
  formatOrderMoney as formatMoneyForCurrency,
  isKnownCurrency,
  summarizeCartCurrency,
  type OrderCurrency,
} from "@/lib/orderCurrency";

export {
  CURRENCY_SYMBOLS,
  isKnownCurrency,
  resolveShippingCost,
  summarizeCartCurrency,
  type OrderCurrency,
  type CartCurrencyLine,
  type CartCurrencySummary,
} from "@/lib/orderCurrency";

// `Product.price` is stored in MIXED, unlabelled currencies (some soles,
// some dollars, no column to tell them apart), and `Stamp.marketPriceUsd`
// is USD by its own column name. A previous pass blanket-labelled every
// order-path amount `US$`, which is a false statement about mixed data —
// this now renders the ACTUAL currency the amount is recorded in, and
// nothing at all when that currency is not known. See src/lib/orderCurrency.ts.
export function formatOrderMoney(amount: number, currency: unknown): string {
  return formatMoneyForCurrency(amount, currency);
}

/**
 * `Order.created_at` is `DATETIME DEFAULT CURRENT_TIMESTAMP`, which D1
 * returns as the UTC string "2026-08-02 15:04:05" — space separated and
 * without a zone, which `new Date()` parses inconsistently across engines
 * and which the profile table used to render raw. Normalised to ISO here,
 * then formatted like every sibling date cell. An unparseable value falls
 * back to the raw string rather than showing "Invalid Date".
 */
export function formatOrderDate(raw: string, locale?: string): string {
  if (typeof raw !== "string" || !raw.trim()) return raw;

  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(locale);
}

export type OrderResponseOutcome =
  | { kind: "created"; orderId: string; totalAmount: number; currency: OrderCurrency | null }
  | {
      kind: "price-changed";
      message: string;
      items: OrderItem[];
      subtotal: number;
      shippingCost: number;
      totalAmount: number;
      currency: OrderCurrency | null;
    }
  | { kind: "unauthenticated"; message: string }
  | { kind: "error"; message: string };

const GENERIC_ERROR = "No se pudo procesar el pedido. Inténtalo nuevamente en unos momentos.";

/**
 * Maps a POST /api/orders response onto something the checkout UI can show.
 * The server's `error` field is never rendered: it is English and, on the
 * failure paths, describes internal infrastructure.
 */
export function interpretOrderResponse(status: number, data: any): OrderResponseOutcome {
  if (status === 401) {
    return {
      kind: "unauthenticated",
      message:
        "Tu sesión expiró o no has iniciado sesión. Inicia sesión para completar tu pedido; " +
        "tu carrito se conserva.",
    };
  }

  if (status === 409 && data?.code === "price_changed") {
    const total = typeof data.totalAmount === "number" ? data.totalAmount : 0;
    const currency = isKnownCurrency(data.currency) ? data.currency : null;
    return {
      kind: "price-changed",
      items: Array.isArray(data.items) ? data.items : [],
      subtotal: typeof data.subtotal === "number" ? data.subtotal : 0,
      shippingCost: typeof data.shippingCost === "number" ? data.shippingCost : 0,
      totalAmount: total,
      currency,
      message:
        `El precio de uno o más artículos cambió mientras estaban en tu carrito. ` +
        `El nuevo total es ${formatOrderMoney(total, currency)}. No se ha cobrado nada: ` +
        `revisa el resumen actualizado y confirma de nuevo si estás de acuerdo.`,
    };
  }

  if (status >= 200 && status < 300 && data?.success && typeof data.orderId === "string") {
    return {
      kind: "created",
      orderId: data.orderId,
      totalAmount: typeof data.totalAmount === "number" ? data.totalAmount : 0,
      currency: isKnownCurrency(data.currency) ? data.currency : null,
    };
  }

  return { kind: "error", message: GENERIC_ERROR };
}
