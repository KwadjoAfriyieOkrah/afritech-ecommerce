import type { Request, Response } from "express";

import {
  initializePayment,
  verifyPayment,
} from "../services/payments.service";
import {
  initializePaymentSchema,
  toPaymentValidationDetails,
} from "../validation/payments.schemas";
import type {
  InitializePaymentResponse,
  VerifyPaymentResponse,
} from "../types/payments";

const MAX_ORDER_ID_LENGTH = 64;
const MAX_REFERENCE_LENGTH = 128;
const MAX_ACCESS_TOKEN_LENGTH = 256;

// Same not-found body as the order endpoints: unknown id, a non-pending or
// expired order, and a malformed id are indistinguishable from outside.
const ORDER_NOT_FOUND_BODY: { error: string } = { error: "Order not found" };
const PROVIDER_UNAVAILABLE_BODY: { error: string } = {
  error: "Payment provider unavailable",
};

// A guest authorises itself with the order access token it received when the
// order was created. The header is only read here; the comparison against the
// stored hash happens in the service, in constant time.
function readAccessToken(req: Request): string | null {
  const raw: unknown = req.headers["x-order-access-token"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ACCESS_TOKEN_LENGTH) {
    return null;
  }
  return trimmed;
}

export async function initializePaymentHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = initializePaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: toPaymentValidationDetails(parsed.error),
    });
    return;
  }

  // A signed-in customer or a guest with the order access token may pay. A
  // caller with neither is answered like an unknown order.
  const user = req.authUser;
  const accessToken = readAccessToken(req);

  if (parsed.data.orderId.length > MAX_ORDER_ID_LENGTH) {
    res.status(404).json(ORDER_NOT_FOUND_BODY);
    return;
  }

  try {
    const result = await initializePayment(
      parsed.data.orderId,
      user ? user.id : null,
      accessToken,
    );

    if (result.kind === "not_found") {
      res.status(404).json(ORDER_NOT_FOUND_BODY);
      return;
    }

    if (result.kind === "already_paid") {
      res.status(409).json({ error: "This order is already paid" });
      return;
    }

    if (result.kind === "expired") {
      res.status(409).json({
        error: "This order can no longer be paid. Please start a new order.",
      });
      return;
    }

    const body: InitializePaymentResponse = {
      reference: result.reference,
      amount: result.amount,
      currency: result.currency,
      email: result.customerEmail,
    };
    res.status(200).json(body);
  } catch (error) {
    console.error("Failed to initialize payment:", error);
    res.status(500).json({ error: "Could not start payment" });
  }
}

export async function verifyPaymentHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const raw: unknown = req.params.reference;
  const reference =
    typeof raw === "string" &&
    raw.length > 0 &&
    raw.length <= MAX_REFERENCE_LENGTH
      ? raw
      : null;

  if (reference === null) {
    res.status(404).json(ORDER_NOT_FOUND_BODY);
    return;
  }

  const user = req.authUser;
  const accessToken = readAccessToken(req);

  try {
    const result = await verifyPayment(
      reference,
      user ? user.id : null,
      accessToken,
    );

    if (result.kind === "not_found") {
      res.status(404).json(ORDER_NOT_FOUND_BODY);
      return;
    }

    if (result.kind === "provider_unavailable") {
      res.status(502).json(PROVIDER_UNAVAILABLE_BODY);
      return;
    }

    const body: VerifyPaymentResponse = {
      verified: result.status === "paid",
      reference,
      status: result.status,
      orderId: result.orderId,
    };
    res.status(200).json(body);
  } catch (error) {
    console.error("Failed to verify payment:", error);
    res.status(500).json({ error: "Could not verify payment" });
  }
}
