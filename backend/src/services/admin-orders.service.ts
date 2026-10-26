import {
  FulfillmentStatus,
  PaymentStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import type { AdminRiderCreateInput } from "../validation/admin-orders.schemas";

export const ORDER_CONFLICT_MESSAGE = "Order changed, reload and try again";
export const DISPATCH_RIDER_REQUIRED_MESSAGE =
  "Assign a rider before dispatch";

export const ORDER_RIDER_ASSIGN_ACTION = "ORDER_RIDER_ASSIGN";
export const ORDER_PACKAGING_ACTION = "ORDER_PACKAGING";
export const ORDER_DISPATCH_ACTION = "ORDER_DISPATCH";
export const ORDER_DELIVERED_ACTION = "ORDER_DELIVERED";
export const RIDER_CREATE_ACTION = "RIDER_CREATE";

const ORDER_ENTITY = "Order";
const RIDER_ENTITY = "Rider";

const adminOrderListSelect = Prisma.validator<Prisma.OrderSelect>()({
  id: true,
  reference: true,
  paymentStatus: true,
  fulfillment: true,
  customerName: true,
  customerPhone: true,
  region: true,
  address: true,
  total: true,
  riderId: true,
  createdAt: true,
});

const adminOrderDetailSelect = Prisma.validator<Prisma.OrderSelect>()({
  id: true,
  reference: true,
  userId: true,
  paymentStatus: true,
  fulfillment: true,
  customerName: true,
  customerPhone: true,
  region: true,
  address: true,
  deliveryFee: true,
  total: true,
  riderId: true,
  createdAt: true,
  updatedAt: true,
  paidAt: true,
  deliveredAt: true,
  items: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { name: true, images: true } },
      color: { select: { name: true } },
    },
  },
  rider: {
    select: {
      id: true,
      name: true,
      phone: true,
      isActive: true,
      createdAt: true,
    },
  },
});

const adminRiderSelect = Prisma.validator<Prisma.RiderSelect>()({
  id: true,
  name: true,
  phone: true,
  isActive: true,
  createdAt: true,
});

type AdminOrderListRow = Prisma.OrderGetPayload<{
  select: typeof adminOrderListSelect;
}>;

type AdminOrderDetailRow = Prisma.OrderGetPayload<{
  select: typeof adminOrderDetailSelect;
}>;

type AdminRiderRow = Prisma.RiderGetPayload<{
  select: typeof adminRiderSelect;
}>;

export interface AdminOrderListItem {
  id: string;
  reference: string;
  paymentStatus: PaymentStatus;
  fulfillment: FulfillmentStatus;
  customerName: string;
  customerPhone: string;
  deliveryArea: string;
  deliveryAddress: string;
  total: number;
  riderId: string | null;
  createdAt: Date;
}

export interface AdminOrderItem {
  id: string;
  productId: string;
  name: string;
  image: string | null;
  quantity: number;
  color: string;
  price: number;
}

export interface AdminRider {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  createdAt: Date;
}

export interface AdminOrderDetail extends AdminOrderListItem {
  userId: string | null;
  deliveryFee: number;
  updatedAt: Date;
  paidAt: Date | null;
  deliveredAt: Date | null;
  items: AdminOrderItem[];
  rider: AdminRider | null;
}

export class OrderTransitionConflictError extends Error {
  constructor(message: string = ORDER_CONFLICT_MESSAGE) {
    super(message);
  }
}

export class AdminRiderNotFoundError extends Error {}

export class RiderInactiveError extends Error {}

function mapAdminOrder(row: AdminOrderListRow): AdminOrderListItem {
  return {
    id: row.id,
    reference: row.reference,
    paymentStatus: row.paymentStatus,
    fulfillment: row.fulfillment,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    deliveryArea: row.region,
    deliveryAddress: row.address,
    total: Number(row.total),
    riderId: row.riderId,
    createdAt: row.createdAt,
  };
}

function mapAdminRider(row: AdminRiderRow): AdminRider {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

function mapAdminOrderDetail(row: AdminOrderDetailRow): AdminOrderDetail {
  return {
    ...mapAdminOrder(row),
    userId: row.userId,
    deliveryFee: Number(row.deliveryFee),
    updatedAt: row.updatedAt,
    paidAt: row.paidAt,
    deliveredAt: row.deliveredAt,
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.product.name,
      image: item.product.images[0] ?? null,
      quantity: item.quantity,
      color: item.color.name,
      price: Number(item.unitPrice),
    })),
    rider: row.rider ? mapAdminRider(row.rider) : null,
  };
}

export async function listOrdersForAdmin(
  fulfillment?: FulfillmentStatus,
): Promise<AdminOrderListItem[]> {
  const orders = await prisma.order.findMany({
    where: fulfillment ? { fulfillment } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: adminOrderListSelect,
  });

  return orders.map(mapAdminOrder);
}

export async function getOrderForAdmin(
  orderId: string,
): Promise<AdminOrderDetail | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: adminOrderDetailSelect,
  });

  return order ? mapAdminOrderDetail(order) : null;
}

export async function listActiveRiders(): Promise<AdminRider[]> {
  const riders = await prisma.rider.findMany({
    where: { isActive: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: adminRiderSelect,
  });

  return riders.map(mapAdminRider);
}

export async function createRider(
  input: AdminRiderCreateInput,
  adminId: string,
): Promise<AdminRider> {
  return prisma.$transaction(async (tx) => {
    const rider = await tx.rider.create({
      data: {
        name: input.name,
        phone: input.phone,
        isActive: true,
      },
      select: adminRiderSelect,
    });

    await tx.adminLog.create({
      data: {
        adminId,
        action: RIDER_CREATE_ACTION,
        entity: RIDER_ENTITY,
        entityId: rider.id,
        meta: {
          before: {},
          after: {
            name: rider.name,
            phone: rider.phone,
            isActive: rider.isActive,
          },
        },
      },
    });

    return mapAdminRider(rider);
  });
}

export async function moveOrderToPackaging(
  orderId: string,
  adminId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        fulfillment: FulfillmentStatus.PENDING,
        paymentStatus: PaymentStatus.PAID,
      },
      data: { fulfillment: FulfillmentStatus.PACKAGING },
    });

    if (updated.count !== 1) {
      throw new OrderTransitionConflictError();
    }

    await tx.adminLog.create({
      data: {
        adminId,
        action: ORDER_PACKAGING_ACTION,
        entity: ORDER_ENTITY,
        entityId: orderId,
        meta: {
          before: { fulfillment: FulfillmentStatus.PENDING },
          after: { fulfillment: FulfillmentStatus.PACKAGING },
        },
      },
    });
  });
}

export async function dispatchOrder(
  orderId: string,
  adminId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        fulfillment: true,
        paymentStatus: true,
        riderId: true,
      },
    });

    if (
      !current ||
      current.fulfillment !== FulfillmentStatus.PACKAGING ||
      current.paymentStatus !== PaymentStatus.PAID
    ) {
      throw new OrderTransitionConflictError();
    }

    if (current.riderId === null) {
      throw new OrderTransitionConflictError(
        DISPATCH_RIDER_REQUIRED_MESSAGE,
      );
    }

    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        fulfillment: FulfillmentStatus.PACKAGING,
        paymentStatus: PaymentStatus.PAID,
        riderId: { not: null },
      },
      data: { fulfillment: FulfillmentStatus.DISPATCHED },
    });

    if (updated.count !== 1) {
      throw new OrderTransitionConflictError();
    }

    await tx.adminLog.create({
      data: {
        adminId,
        action: ORDER_DISPATCH_ACTION,
        entity: ORDER_ENTITY,
        entityId: orderId,
        meta: {
          before: { fulfillment: FulfillmentStatus.PACKAGING },
          after: { fulfillment: FulfillmentStatus.DISPATCHED },
        },
      },
    });
  });
}

export async function markOrderDelivered(
  orderId: string,
  adminId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const deliveredAt = new Date();

    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        fulfillment: FulfillmentStatus.DISPATCHED,
        paymentStatus: PaymentStatus.PAID,
      },
      data: {
        fulfillment: FulfillmentStatus.DELIVERED,
        deliveredAt,
      },
    });

    if (updated.count !== 1) {
      throw new OrderTransitionConflictError();
    }

    await tx.adminLog.create({
      data: {
        adminId,
        action: ORDER_DELIVERED_ACTION,
        entity: ORDER_ENTITY,
        entityId: orderId,
        meta: {
          before: {
            fulfillment: FulfillmentStatus.DISPATCHED,
            deliveredAt: null,
          },
          after: {
            fulfillment: FulfillmentStatus.DELIVERED,
            deliveredAt: deliveredAt.toISOString(),
          },
        },
      },
    });
  });
}

export async function assignRider(
  orderId: string,
  riderId: string,
  adminId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        fulfillment: true,
        paymentStatus: true,
        riderId: true,
      },
    });

    if (
      !current ||
      current.paymentStatus !== PaymentStatus.PAID ||
      (current.fulfillment !== FulfillmentStatus.PENDING &&
        current.fulfillment !== FulfillmentStatus.PACKAGING)
    ) {
      throw new OrderTransitionConflictError();
    }

    const rider = await tx.rider.findUnique({
      where: { id: riderId },
      select: { isActive: true },
    });

    if (!rider) {
      throw new AdminRiderNotFoundError();
    }
    if (!rider.isActive) {
      throw new RiderInactiveError();
    }

    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        fulfillment: current.fulfillment,
        paymentStatus: PaymentStatus.PAID,
      },
      data: { riderId },
    });

    if (updated.count !== 1) {
      throw new OrderTransitionConflictError();
    }

    await tx.adminLog.create({
      data: {
        adminId,
        action: ORDER_RIDER_ASSIGN_ACTION,
        entity: ORDER_ENTITY,
        entityId: orderId,
        meta: {
          before: { riderId: current.riderId },
          after: { riderId },
        },
      },
    });
  });
}
