import { FulfillmentStatus, PaymentStatus, Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";
import type {
  OrderItemResponse,
  OrderResponse,
  OrderStatusResponse,
  RiderResponse,
} from "../types/orders";

const GREATER_ACCRA = "Greater Accra";
const EXPRESS_DELIVERY_DAYS = 1;
const STANDARD_DELIVERY_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const orderSelect = Prisma.validator<Prisma.OrderSelect>()({
  id: true,
  reference: true,
  userId: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  region: true,
  address: true,
  deliveryFee: true,
  total: true,
  paymentStatus: true,
  fulfillment: true,
  paystackRef: true,
  createdAt: true,
  updatedAt: true,
  rider: { select: { name: true, phone: true } },
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { name: true, images: true } },
      color: { select: { name: true } },
    },
  },
});

type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
type OrderItemRow = OrderRow["items"][number];

function mapPaymentToStatus(
  paymentStatus: PaymentStatus,
  fulfillment: FulfillmentStatus,
): OrderStatusResponse {
  if (paymentStatus !== PaymentStatus.PAID) return "pending";

  switch (fulfillment) {
    case FulfillmentStatus.PENDING:
      return "paid";
    case FulfillmentStatus.PACKAGING:
      return "packaging";
    case FulfillmentStatus.DISPATCHED:
      return "dispatched";
    case FulfillmentStatus.DELIVERED:
      return "delivered";
    default:
      throw new Error(`Unknown fulfillment status: ${String(fulfillment)}`);
  }
}

function estimateDeliveryDate(createdAt: Date, region: string): string {
  const days =
    region === GREATER_ACCRA ? EXPRESS_DELIVERY_DAYS : STANDARD_DELIVERY_DAYS;
  return new Date(createdAt.getTime() + days * MS_PER_DAY).toISOString();
}

function mapItem(item: OrderItemRow): OrderItemResponse {
  return {
    id: item.id,
    productId: item.productId,
    name: item.product.name,
    image: item.product.images[0] ?? null,
    quantity: item.quantity,
    color: item.color.name,
    price: Number(item.unitPrice),
  };
}

function mapRider(rider: OrderRow["rider"]): RiderResponse | null {
  if (!rider) return null;
  return { name: rider.name, phone: rider.phone };
}

function mapOrder(order: OrderRow): OrderResponse {
  if (order.userId === null) {
    throw new Error(`Order ${order.id} is not linked to a user`);
  }

  const subtotal = order.items.reduce(
    (sum, item) => sum + Number(item.unitPrice) * item.quantity,
    0,
  );

  return {
    id: order.id,
    reference: order.reference,
    userId: order.userId,
    items: order.items.map(mapItem),
    subtotal,
    deliveryFee: Number(order.deliveryFee),
    totalPrice: Number(order.total),
    status: mapPaymentToStatus(order.paymentStatus, order.fulfillment),
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    deliveryArea: order.region,
    deliveryAddress: order.address,
    expectedDeliveryDate: estimateDeliveryDate(order.createdAt, order.region),
    paymentReference: order.paystackRef ?? null,
    isPaid: order.paymentStatus === PaymentStatus.PAID,
    rider: mapRider(order.rider),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export async function listOrdersForUser(userId: string): Promise<OrderResponse[]> {
  const orders = await prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: orderSelect,
  });

  return orders.map(mapOrder);
}
