export interface OrderItemResponse {
  id: string;
  productId: string;
  name: string;
  image: string | null;
  quantity: number;
  color: string;
  price: number;
}

export interface RiderResponse {
  name: string;
  phone: string;
}

export type OrderStatusResponse =
  | "pending"
  | "paid"
  | "packaging"
  | "dispatched"
  | "delivered";

export interface OrderResponse {
  id: string;
  reference: string;
  userId: string | null;
  items: OrderItemResponse[];
  subtotal: number;
  deliveryFee: number;
  totalPrice: number;
  status: OrderStatusResponse;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  deliveryArea: string;
  deliveryAddress: string;
  expectedDeliveryDate: string;
  paymentReference: string | null;
  isPaid: boolean;
  rider: RiderResponse | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public order tracking. It carries only what a customer who knows the
 * reference and the phone number may see, and the rider is disclosed once the
 * order is on the road.
 */
export interface TrackOrderResponse {
  reference: string;
  status: OrderStatusResponse;
  items: OrderItemResponse[];
  total: number;
  deliveryFee: number;
  expectedDeliveryDate: string;
  /** Absent until the order is dispatched or delivered. */
  rider?: RiderResponse;
}
