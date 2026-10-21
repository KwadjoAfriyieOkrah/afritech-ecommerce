export enum OrderStatus {
  PENDING = 'pending',
  PAID = 'paid',
  PACKAGING = 'packaging',
  DISPATCHED = 'dispatched',
  DELIVERED = 'delivered'
}

export interface Product {
  id: string;
  name: string;
  price: number;
  colors: string[];
  specs?: Record<string, string>;
  stock: number;
  category: string;
  image: string | null;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  /**
   * Server flag: the product has no stock left in any of its colours. It is
   * passed through from the API untouched, so the storefront never has to
   * derive it from `stock`.
   */
  soldOut: boolean;
}

export interface OrderItem {
  id: string;
  productId: string;
  name?: string;
  image?: string;
  quantity: number;
  color?: string;
  price: number;
}

export interface RiderInfo {
  name: string;
  phone: string;
  vehicle?: string;
}

export interface Order {
  id: string;
  reference: string;
  userId: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  totalPrice: number;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  deliveryArea: string;
  deliveryAddress: string;
  expectedDeliveryDate: string;
  paymentReference?: string;
  isPaid: boolean;
  rider?: RiderInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  phone: string;
  name: string;
  address?: string;
  location?: string;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface DeliveryInfo {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  deliveryArea: string;
  deliveryAddress: string;
  expectedDeliveryDays: number;
  expectedDeliveryDate: string;
}

export type CreateOrderPayload = Omit<DeliveryInfo, 'expectedDeliveryDays'> & {
  items: Array<Pick<OrderItem, 'productId' | 'quantity' | 'color' | 'price'>>;
};

/**
 * What checkout actually POSTs to `POST /orders`. `expectedDeliveryDate` is
 * display-only: the backend derives it from the delivery zone and rejects any
 * unrecognized field, so it is left out of the request body entirely.
 */
export type CreateOrderRequestBody = Omit<CreateOrderPayload, 'expectedDeliveryDate'>;

export interface ProductFilters {
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  colors?: string[];
  inStock?: boolean;
  page?: number;
  limit?: number;
}

export interface PaymentVerification {
  verified: boolean;
  reference: string;
  amount?: number;
  status?: string;
  message?: string;
  orderId?: string;
  updatedStatus?: OrderStatus;
}

/**
 * A backend-authorized payment attempt. The reference is generated and stored
 * by the backend before it is handed to the client; the frontend passes it to
 * the Paystack inline modal and back to verification, but never chooses it.
 * Amount (in pesewas) and email are server-authoritative.
 */
export interface PaymentAttempt {
  reference: string;
  amount: number;
  currency: string;
  email: string;
}

export interface TrackingStage {
  status: OrderStatus;
  label: string;
  description: string;
}

export type TrackingStageState = 'completed' | 'current' | 'upcoming';