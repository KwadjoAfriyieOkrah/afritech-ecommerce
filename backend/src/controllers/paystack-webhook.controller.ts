import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";

import { env } from "../lib/env";
import { markOrderPaid } from "../services/payments.service";

const SIGNATURE_HEADER = "x-paystack-signature";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasValidSignature(rawBody: Buffer, signature: string): boolean {
  const expected = createHmac("sha512", env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  const expectedBytes = Buffer.from(expected, "hex");
  const providedBytes = Buffer.from(signature, "hex");

  if (expectedBytes.length === 0) return false;
  if (expectedBytes.length !== providedBytes.length) return false;

  return timingSafeEqual(expectedBytes, providedBytes);
}

// Mounted before express.json() so req.body is still the raw bytes Paystack
// signed. The signature is checked before any parsing; nothing else in this
// handler runs until it passes.
export async function handlePaystackWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const rawHeader = req.headers[SIGNATURE_HEADER];
  const signature = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (
    !Buffer.isBuffer(req.body) ||
    typeof signature !== "string" ||
    signature.length === 0 ||
    !hasValidSignature(req.body, signature)
  ) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch (error) {
    console.error("Paystack webhook body is not valid JSON:", error);
    res.status(200).json({ received: true });
    return;
  }

  if (
    !isRecord(payload) ||
    payload.event !== "charge.success" ||
    !isRecord(payload.data)
  ) {
    res.status(200).json({ received: true });
    return;
  }

  const data = payload.data;
  const reference = typeof data.reference === "string" ? data.reference : "";
  if (reference.length === 0) {
    console.warn("Paystack webhook charge.success has no reference");
    res.status(200).json({ received: true });
    return;
  }

  const paidAtRaw = toPaystackDate(data.paid_at) ?? new Date();
  const currency = typeof data.currency === "string" ? data.currency : "";

  try {
    await markOrderPaid(reference, data.amount, currency, paidAtRaw);
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Paystack webhook failed to update the order:", error);
    res.status(500).json({ error: "Could not process webhook" });
  }
}

function toPaystackDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
