import {
  FulfillmentStatus,
  InventoryReason,
  PaymentStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import type {
  OrderItemResponse,
  OrderResponse,
  OrderStatusResponse,
  RiderResponse,
} from "../types/orders";

const STANDARD_DELIVERY_DAYS = 3;
const RESERVATION_WINDOW_MS = 15 * 60 * 1000;
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

export interface CreateOrderItemInput {
  productId: string;
  color: string;
  quantity: number;
}

export interface CreateOrderInput {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryArea: string;
  deliveryAddress: string;
  items: CreateOrderItemInput[];
  idempotencyKey: string;
  userId: string | null;
}

export interface CreateOrderResult {
  status: 200 | 201;
  order: OrderResponse;
}

export interface InvalidItemDetail {
  productId: string;
  color: string;
}

export class InvalidItemError extends Error {
  readonly details: InvalidItemDetail[];

  constructor(details: InvalidItemDetail[]) {
    super("One or more items are invalid");
    this.name = "InvalidItemError";
    this.details = details;
    Object.setPrototypeOf(this, InvalidItemError.prototype);
  }
}

export class UnknownDeliveryZoneError extends Error {
  readonly area: string;

  constructor(area: string) {
    super(`Unknown or inactive delivery area: ${area}`);
    this.name = "UnknownDeliveryZoneError";
    this.area = area;
    Object.setPrototypeOf(this, UnknownDeliveryZoneError.prototype);
  }
}

export interface UnavailableItemDetail {
  productId: string;
  color: string;
  requested: number;
  available: number;
}

export class InsufficientStockError extends Error {
  readonly details: UnavailableItemDetail[];

  constructor(details: UnavailableItemDetail[]) {
    super("Some items are no longer available");
    this.name = "InsufficientStockError";
    this.details = details;
    Object.setPrototypeOf(this, InsufficientStockError.prototype);
  }
}

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

// Shared by the checkout and order-history endpoints so both always agree.
function formatExpectedDeliveryDate(
  createdAt: Date,
  expectedDays: number,
): string {
  return new Date(createdAt.getTime() + expectedDays * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
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

function mapOrder(
  order: OrderRow,
  expectedDaysByRegion: Map<string, number>,
): OrderResponse {
  const expectedDays =
    expectedDaysByRegion.get(order.region) ?? STANDARD_DELIVERY_DAYS;

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
    expectedDeliveryDate: formatExpectedDeliveryDate(order.createdAt, expectedDays),
    paymentReference: order.paystackRef ?? null,
    isPaid: order.paymentStatus === PaymentStatus.PAID,
    rider: mapRider(order.rider),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

async function loadExpectedDeliveryDays(
  regions: string[],
): Promise<Map<string, number>> {
  const uniqueRegions = [...new Set(regions)];
  if (uniqueRegions.length === 0) return new Map();

  const zones = await prisma.deliveryZone.findMany({
    where: { name: { in: uniqueRegions } },
    select: { name: true, expectedDays: true },
  });

  return new Map(zones.map((zone) => [zone.name, zone.expectedDays]));
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  const target = error.meta?.target;
  if (typeof target === "string") return target.includes(field);
  if (Array.isArray(target)) {
    return target.some((value) => value === field);
  }
  return false;
}

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function formatReference(date: Date, sequence: number): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `AF-${year}${month}${day}-${String(sequence).padStart(4, "0")}`;
}

export async function listOrdersForUser(
  userId: string,
): Promise<OrderResponse[]> {
  const orders = await prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: orderSelect,
  });

  const expectedDaysByRegion = await loadExpectedDeliveryDays(
    orders.map((order) => order.region),
  );

  return orders.map((order) => mapOrder(order, expectedDaysByRegion));
}

interface ResolvedLine {
  productId: string;
  colorId: string;
  colorName: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
}

export async function createOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const existing = await prisma.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: orderSelect,
  });
  if (existing) {
    const expectedDaysByRegion = await loadExpectedDeliveryDays([
      existing.region,
    ]);
    return { status: 200, order: mapOrder(existing, expectedDaysByRegion) };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();

      const productIds = [...new Set(input.items.map((item) => item.productId))];
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, isActive: true },
        select: { id: true, basePrice: true },
      });
      const productById = new Map(products.map((product) => [product.id, product]));

      const colors = await tx.color.findMany({
        where: {
          OR: input.items.map((item) => ({
            productId: item.productId,
            name: item.color,
          })),
        },
        select: { id: true, productId: true, name: true },
      });
      const colorByKey = new Map(
        colors.map((color) => [`${color.productId}::${color.name}`, color]),
      );

      const invalid: InvalidItemDetail[] = [];
      const lines: ResolvedLine[] = [];

      for (const item of input.items) {
        const product = productById.get(item.productId);
        const color = colorByKey.get(`${item.productId}::${item.color}`);
        if (!product || !color) {
          invalid.push({ productId: item.productId, color: item.color });
          continue;
        }

        lines.push({
          productId: product.id,
          colorId: color.id,
          colorName: color.name,
          quantity: item.quantity,
          unitPrice: product.basePrice,
        });
      }

      if (invalid.length > 0) throw new InvalidItemError(invalid);

      const zone = await tx.deliveryZone.findFirst({
        where: { name: input.deliveryArea, isActive: true },
        select: { name: true, fee: true, expectedDays: true },
      });
      if (!zone) throw new UnknownDeliveryZoneError(input.deliveryArea);

      for (const line of lines) {
        const reserved = await tx.color.updateMany({
          where: { id: line.colorId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });

        if (reserved.count === 0) {
          const current = await tx.color.findUnique({
            where: { id: line.colorId },
            select: { stock: true },
          });
          throw new InsufficientStockError([
            {
              productId: line.productId,
              color: line.colorName,
              requested: line.quantity,
              available: current?.stock ?? 0,
            },
          ]);
        }
      }

      const counterDate = utcDayStart(now);
      const counter = await tx.orderCounter.upsert({
        where: { date: counterDate },
        create: { date: counterDate, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
        select: { lastNumber: true },
      });

      const subtotal = lines.reduce(
        (sum, line) => sum.add(line.unitPrice.mul(line.quantity)),
        new Prisma.Decimal(0),
      );
      const total = subtotal.add(zone.fee);
      const reservedUntil = new Date(now.getTime() + RESERVATION_WINDOW_MS);

      const created = await tx.order.create({
        data: {
          reference: formatReference(now, counter.lastNumber),
          userId: input.userId,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          region: zone.name,
          address: input.deliveryAddress,
          deliveryFee: zone.fee,
          total,
          paymentStatus: PaymentStatus.PENDING,
          fulfillment: FulfillmentStatus.PENDING,
          reservedUntil,
          idempotencyKey: input.idempotencyKey,
          items: {
            create: lines.map((line) => ({
              productId: line.productId,
              colorId: line.colorId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
            })),
          },
        },
        select: { id: true },
      });

      await tx.inventoryLog.createMany({
        data: lines.map((line) => ({
          colorId: line.colorId,
          change: -line.quantity,
          reason: InventoryReason.ORDER,
          orderId: created.id,
        })),
      });

      const full = await tx.order.findUniqueOrThrow({
        where: { id: created.id },
        select: orderSelect,
      });

      return { order: full, expectedDays: zone.expectedDays };
    });

    const expectedDaysByRegion = new Map([
      [result.order.region, result.expectedDays],
    ]);
    return { status: 201, order: mapOrder(result.order, expectedDaysByRegion) };
  } catch (error) {
    if (isUniqueViolation(error, "idempotencyKey")) {
      const winner = await prisma.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: orderSelect,
      });
      if (winner) {
        const expectedDaysByRegion = await loadExpectedDeliveryDays([
          winner.region,
        ]);
        return { status: 200, order: mapOrder(winner, expectedDaysByRegion) };
      }
    }
    throw error;
  }
}
