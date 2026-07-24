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
  status: OrderStatus;
  shippingDetails: ShippingDetails;
  paymentMethod: PaymentMethod;
  items: OrderItem[];
}
