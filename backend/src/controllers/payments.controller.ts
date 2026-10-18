import type { Request, Response } from "express";

import {
  initializePayment,
  verifyPayment,
} from "../services/payments.service";
import {
  initializePaymentSchema,
  toPaymentValidationDetails,
} from "../validation/payments.schemas";
import { UNAUTHORIZED_MESSAGE } from "../middleware/requireAuth";
import type {
  InitializePaymentResponse,
  VerifyPaymentResponse,
} from "../types/payments";

const MAX_ORDER_ID_LENGTH = 64;
const MAX_REFERENCE_LENGTH = 128;

// Same not-found body as the order endpoints: unknown id, a non-pending or
// expired order, and a malformed id are indistinguishable from outside.
const ORDER_NOT_FOUND_BODY: { error: string } = { error: "Order not found" };
const PROVIDER_UNAVAILABLE_BODY: { error: string } = {
  error: "Payment provider unavailable",
};

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

  // requireAuth guarantees a user; this narrows the type without a cast and
  // keeps the ownership requirement explicit.
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  if (parsed.data.orderId.length > MAX_ORDER_ID_LENGTH) {
    res.status(404).json(ORDER_NOT_FOUND_BODY);
    return;
  }

  try {
    const result = await initializePayment(parsed.data.orderId, user.id);

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
      email: result.email,
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
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  try {
    const result = await verifyPayment(reference, user.id);

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
