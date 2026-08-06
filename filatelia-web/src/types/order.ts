import type { OrderCurrency } from '@/lib/orderCurrency';

export type PaymentMethod = 'mercadopago' | 'paypal' | 'yape_plin' | 'bank_transfer';

export type OrderStatus = 'Pending' | 'Processing' | 'Completed' | 'Cancelled';

export interface ShippingDetails {
  fullName: string;
  address: string;
  city: string;
  postalCode: string;
  phone: string;
}

export interface OrderItem {
  id: string;
  title: string;
  price: number;
  quantity: number;
  image?: string;
  scott?: string;
  // Server-derived from the catalog (see `priceOrder`), never trusted from
  // the client. `null`/absent means the catalog row has not declared a
  // currency yet — that state is displayed, never coerced to a default.
  currency?: OrderCurrency | null;
}

export interface CreateOrderPayload {
  items: OrderItem[];
  shippingDetails: ShippingDetails;
  paymentMethod: PaymentMethod;
  subtotal: number;
  shippingCost: number;
  totalAmount: number;
}

export interface OrderRecord {
  id: string;
  date: string;
  itemsCount: number;
  totalAmount: number;
  // The currency the order was actually persisted in. Always a known
  // currency for a real record — `priceOrder` refuses to create an order
  // it cannot assign exactly one currency to.
  currency: OrderCurrency;
  status: OrderStatus;
  shippingDetails: ShippingDetails;
  paymentMethod: PaymentMethod;
  items: OrderItem[];
}
