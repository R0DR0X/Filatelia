import { NextRequest, NextResponse } from "next/server";
import { CreateOrderPayload } from "@/types/order";

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const body: CreateOrderPayload = await req.json();

    const { items, shippingDetails, paymentMethod } = body || {};

    // Validate cart items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Missing required shipping details or empty cart" },
        { status: 400 }
      );
    }

    // Validate shipping details
    if (
      !shippingDetails ||
      !shippingDetails.fullName?.trim() ||
      !shippingDetails.address?.trim() ||
      !shippingDetails.city?.trim() ||
      !shippingDetails.postalCode?.trim() ||
      !shippingDetails.phone?.trim()
    ) {
      return NextResponse.json(
        { success: false, error: "Missing required shipping details or empty cart" },
        { status: 400 }
      );
    }

    // Validate payment method
    const validPaymentMethods = ["mercadopago", "paypal", "yape_plin", "bank_transfer"];
    if (!paymentMethod || !validPaymentMethods.includes(paymentMethod)) {
      return NextResponse.json(
        { success: false, error: "Invalid payment method specified" },
        { status: 400 }
      );
    }

    // Generate Order ID
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    const orderId = `ORD-2026-${randomDigits}`;

    return NextResponse.json(
      {
        success: true,
        orderId,
        message: "Order created successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Invalid order payload format" },
      { status: 400 }
    );
  }
}
