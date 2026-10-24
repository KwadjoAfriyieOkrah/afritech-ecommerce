import type { Request, Response } from "express";
import type { ZodError } from "zod";

import { UNAUTHORIZED_MESSAGE } from "../middleware/requireAuth";
import {
  createOrder,
  getOrderForUser,
  IdempotencyKeyConflictError,
  InsufficientStockError,
  InvalidItemError,
  listOrdersForUser,
  trackOrder,
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

function readQueryString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

  // A guest may check out without an account, so a missing user is normal
  // here. A present but invalid bearer token was already rejected by
  // optionalAuth.
  const user = req.authUser;
  const customerEmail =
    parsed.data.customerEmail.length > 0 ? parsed.data.customerEmail : null;

  try {
    const result = await createOrder({
      customerName: parsed.data.customerName,
      customerEmail,
      customerPhone: parsed.data.customerPhone,
      deliveryArea: parsed.data.deliveryArea,
      deliveryAddress: parsed.data.deliveryAddress,
      items: parsed.data.items.map((item) => ({
        productId: item.productId,
        color: item.color,
        quantity: item.quantity,
      })),
      idempotencyKey,
      userId: user ? user.id : null,
    });

    // The access token is returned once, on creation. It is the only way for a
    // guest to reach the order afterwards.
    res.status(result.status).json({
      ...result.order,
      accessToken: result.accessToken,
    });
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

    if (error instanceof IdempotencyKeyConflictError) {
      res.status(409).json({
        error: "This checkout attempt could not be completed. Please try again.",
      });
      return;
    }

    console.error("Failed to create order:", error);
    res.status(500).json({ error: "Could not create order" });
  }
}

// Public tracking. The reference plus the phone number on the order are the
// two factors. This endpoint is rate limited in production, because it is open
// to guests.
export async function trackOrderHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const reference = readQueryString(req.query.reference);
  const phone = readQueryString(req.query.phone);

  // A missing field is answered exactly like an unknown order, so the
  // endpoint never confirms that a reference exists.
  if (!reference || !phone) {
    res.status(404).json(ORDER_NOT_FOUND_BODY);
    return;
  }

  try {
    const tracked = await trackOrder(reference, phone);
    if (!tracked) {
      res.status(404).json(ORDER_NOT_FOUND_BODY);
      return;
    }

    res.status(200).json(tracked);
  } catch (error) {
    console.error("Failed to track order:", error);
    res.status(500).json({ error: "Could not track order" });
  }
}
