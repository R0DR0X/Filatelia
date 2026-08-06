import { NextRequest, NextResponse } from "next/server";
import { CreateOrderPayload } from "@/types/order";
import { createOrder, getUserOrders, priceOrder, OrderValidationError } from "@/lib/db/orders";
import { verifySession } from "@/lib/session";

export const runtime = 'edge';

// Server-side only, same convention as src/app/api/admin/[...path]/route.ts
// (which logs WHICH gate rejected a request). The client-visible body for a
// failed POST is deliberately one opaque message regardless of cause, so
// these lines are the only way an operator can tell a rejected payload apart
// from a database failure when a buyer reports a vanished order. Never log
// the session cookie or the shipping details.
const LOG_PREFIX = "[orders-api]";

async function getUserIdFromSession(request: NextRequest): Promise<string | null> {
  const sessionCookie = request.cookies.get("fp_session")?.value;
  if (!sessionCookie) {
    return null;
  }

  const payload = await verifySession(sessionCookie);
  return payload?.id || null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const orders = await getUserOrders(userId);
    return NextResponse.json({ success: true, orders });
  } catch (error: any) {
    // Opaque on purpose, exactly like the POST path below and as this
    // file's header promises. `error.message` here is the D1 binding
    // diagnostic, which names internal infrastructure; it belongs in the
    // log, not in a browser.
    console.error(`${LOG_PREFIX} failed to read order history for user ${userId}`, error);
    return NextResponse.json(
      { success: false, error: "Could not read order history" },
      { status: 500 }
    );
  }
}

/**
 * Every shipping field lands in a NOT NULL text column of a money record, so
 * a non-string value is a rejected payload, not an infrastructure incident.
 * Calling `.trim()` on a number used to throw a TypeError that got logged as
 * "database error, no order was persisted".
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Amounts are compared at cent precision; both sides are float dollars. */
const TOTAL_TOLERANCE = 0.005;

export async function POST(req: NextRequest) {
  const userId = await getUserIdFromSession(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body: CreateOrderPayload = await req.json();

    const { items, shippingDetails, paymentMethod, totalAmount: confirmedTotal } = body || {};

    // Validate cart items
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.warn(`${LOG_PREFIX} rejected: empty or malformed cart — user ${userId}`);
      return NextResponse.json(
        { success: false, error: "Missing required shipping details or empty cart" },
        { status: 400 }
      );
    }

    // Validate shipping details. Type first, then emptiness: a non-string
    // value is a hostile/malformed payload and must be reported as one.
    if (
      !shippingDetails ||
      typeof shippingDetails !== "object" ||
      !isNonEmptyString(shippingDetails.fullName) ||
      !isNonEmptyString(shippingDetails.address) ||
      !isNonEmptyString(shippingDetails.city) ||
      !isNonEmptyString(shippingDetails.postalCode) ||
      !isNonEmptyString(shippingDetails.phone)
    ) {
      console.warn(
        `${LOG_PREFIX} rejected: missing, non-string or empty shipping details — user ${userId}`
      );
      return NextResponse.json(
        { success: false, error: "Missing required shipping details or empty cart" },
        { status: 400 }
      );
    }

    // Validate payment method
    const validPaymentMethods = ["mercadopago", "paypal", "yape_plin", "bank_transfer"];
    if (!paymentMethod || !validPaymentMethods.includes(paymentMethod)) {
      console.warn(
        `${LOG_PREFIX} rejected: invalid payment method '${paymentMethod}' — user ${userId}`
      );
      return NextResponse.json(
        { success: false, error: "Invalid payment method specified" },
        { status: 400 }
      );
    }

    // The buyer confirms a specific number. Cart prices are frozen in
    // localStorage at add-to-cart time (zustand persist, key
    // `filatelia-cart`), so by the time they press "Confirmar y Pagar" the
    // live catalog may say something else. `totalAmount` is what they saw.
    if (typeof confirmedTotal !== "number" || !Number.isFinite(confirmedTotal) || confirmedTotal < 0) {
      console.warn(
        `${LOG_PREFIX} rejected: no confirmed totalAmount in the payload — user ${userId}`
      );
      return NextResponse.json(
        { success: false, error: "Missing required shipping details or empty cart" },
        { status: 400 }
      );
    }

    const priced = await priceOrder(body);

    // DECISION: reject-and-show, not silently reprice.
    //
    // The two options were (a) charge the live total anyway and tell the
    // buyer afterwards, or (b) write nothing and hand the new total back so
    // they confirm it explicitly. (b) is the only one where the number the
    // buyer agreed to and the number persisted against their payment are the
    // same number — under (a) an order exists for an amount they never saw,
    // which is precisely what a payment dispute is made of, and "we told you
    // on the confirmation screen" is not consent. The cost of (b) is one
    // extra click on the rare price change; the cost of (a) is a charge the
    // buyer never approved. This is not an infrastructure error, so it gets
    // its own status (409) and its own client copy, not the opaque 400.
    if (Math.abs(priced.totalAmount - confirmedTotal) > TOTAL_TOLERANCE) {
      console.warn(
        `${LOG_PREFIX} price change: buyer confirmed ${confirmedTotal}, catalog says ` +
        `${priced.totalAmount} — user ${userId}, nothing persisted`
      );
      return NextResponse.json(
        {
          success: false,
          code: "price_changed",
          error: "Order total changed",
          items: priced.items,
          subtotal: priced.subtotal,
          shippingCost: priced.shippingCost,
          totalAmount: priced.totalAmount,
          currency: priced.currency,
        },
        { status: 409 }
      );
    }

    // `userId` always comes from the verified session above — never from
    // the request body — so an order can never be attached to a spoofed
    // owner. Prices, totals AND item descriptions are all re-derived from
    // the catalog by priceOrder(); nothing in `body` except the ids, the
    // quantities and the shipping/payment choice is persisted.
    const order = await createOrder(userId, body, priced);

    return NextResponse.json(
      {
        success: true,
        orderId: order.id,
        message: "Order created successfully",
        // Echo the totals actually persisted so the client can render the
        // real number instead of its own stale arithmetic.
        items: order.items,
        subtotal: priced.subtotal,
        shippingCost: priced.shippingCost,
        totalAmount: order.totalAmount,
        currency: order.currency,
      },
      { status: 201 }
    );
  } catch (error) {
    // The client-visible body is intentionally the same opaque message for
    // every failure below; only these log lines separate them.
    if (error instanceof OrderValidationError) {
      // The caller sent something unacceptable (unknown stamp, no catalog
      // price, bad quantity). Nothing was written. Ordinary, expected.
      console.warn(`${LOG_PREFIX} rejected: ${error.message} — user ${userId}`);
    } else if (error instanceof SyntaxError) {
      console.warn(`${LOG_PREFIX} rejected: request body is not valid JSON — user ${userId}`);
    } else {
      // A database/infrastructure failure. The order write is a single
      // transactional D1 batch, so nothing partial was persisted — but this
      // IS an incident and must not be filed as a bad payload.
      console.error(
        `${LOG_PREFIX} order creation FAILED for user ${userId} — database error, no order was persisted`,
        error
      );
    }

    return NextResponse.json(
      { success: false, error: "Invalid order payload format" },
      { status: 400 }
    );
  }
}
