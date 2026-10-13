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
  customerEmail: string;
  deliveryArea: string;
  deliveryAddress: string;
  expectedDeliveryDate: string;
  paymentReference: string | null;
  isPaid: boolean;
  rider: RiderResponse | null;
  createdAt: string;
  updatedAt: string;
}
