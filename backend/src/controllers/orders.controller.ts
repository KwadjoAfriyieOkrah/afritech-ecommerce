import type { Request, Response } from "express";
import type { ZodError } from "zod";

import { UNAUTHORIZED_MESSAGE } from "../middleware/requireAuth";
import {
  createOrder,
  getOrderForUser,
  InsufficientStockError,
  InvalidItemError,
  listOrdersForUser,
  UnknownDeliveryZoneError,
} from "../services/orders.service";
import {
  createOrderSchema,
  toOrderValidationDetails,
} from "../validation/orders.schemas";

const MIN_IDEMPOTENCY_KEY_LENGTH = 16;
const MAX_IDEMPOTENCY_KEY_LENGTH = 64;
const MAX_ORDER_ID_LENGTH = 64;

// Single source for the not-found body. Every miss path (unknown id, another
// user's order, guest order, malformed id) sends this exact object so the
// responses stay byte-identical and cannot leak ownership.
const ORDER_NOT_FOUND_BODY: { error: string } = { error: "Order not found" };

function isValidOrderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ORDER_ID_LENGTH
  );
}

function readIdempotencyKey(req: Request): string | null {
  const raw = req.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  if (
    value.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
    value.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    return null;
  }
  return value;
}

function sendValidationError(error: ZodError, res: Response): void {
  res.status(400).json({
    error: "Validation failed",
    details: toOrderValidationDetails(error),
  });
}

export async function listOrders(req: Request, res: Response): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  try {
    const orders = await listOrdersForUser(user.id);
    res.status(200).json(orders);
  } catch (error) {
    console.error("Failed to list orders:", error);
    res.status(500).json({ error: "Could not load orders" });
  }
}

export async function getOrder(req: Request, res: Response): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  try {
    const rawId: unknown = req.params.id;
    const order = isValidOrderId(rawId)
      ? await getOrderForUser(user.id, rawId)
      : null;

    if (!order) {
      res.status(404).json(ORDER_NOT_FOUND_BODY);
      return;
    }

    res.status(200).json(order);
  } catch (error) {
    console.error("Failed to load order:", error);
    res.status(500).json({ error: "Could not load order" });
  }
}

export async function submitOrder(req: Request, res: Response): Promise<void> {
  const idempotencyKey = readIdempotencyKey(req);
  if (!idempotencyKey) {
    res.status(400).json({
      error: "Validation failed",
      details: [
        {
          field: "Idempotency-Key",
          message: "Provide an Idempotency-Key header of 16 to 64 characters",
        },
      ],
    });
    return;
  }

  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(parsed.error, res);
    return;
  }

  const userId = req.authUser ? req.authUser.id : null;

  try {
    const result = await createOrder({
      customerName: parsed.data.customerName,
      customerEmail: parsed.data.customerEmail,
      customerPhone: parsed.data.customerPhone,
      deliveryArea: parsed.data.deliveryArea,
      deliveryAddress: parsed.data.deliveryAddress,
      items: parsed.data.items.map((item) => ({
        productId: item.productId,
        color: item.color,
        quantity: item.quantity,
      })),
      idempotencyKey,
      userId,
    });

    res.status(result.status).json(result.order);
  } catch (error) {
    if (error instanceof InvalidItemError) {
      res.status(400).json({ error: "Invalid item", details: error.details });
      return;
    }

    if (error instanceof UnknownDeliveryZoneError) {
      res.status(400).json({
        error: "Validation failed",
        details: [
          {
            field: "deliveryArea",
            message: error.message,
          },
        ],
      });
      return;
    }

    if (error instanceof InsufficientStockError) {
      res.status(409).json({
        error: "Some items are no longer available",
        details: error.details,
      });
      return;
    }

    console.error("Failed to create order:", error);
    res.status(500).json({ error: "Could not create order" });
  }
}
