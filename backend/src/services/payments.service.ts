import { PaymentStatus, Prisma } from "@prisma/client";

import { env } from "../lib/env";
import { prisma } from "../lib/prisma";
import type { PaymentStatusResponse } from "../types/payments";

const PAYSTACK_API_BASE = "https://api.paystack.co";
const PAYSTACK_CURRENCY = "GHS";

export type InitializePaymentOutcome =
  | { kind: "ok"; authorizationUrl: string; reference: string }
  | { kind: "not_found" }
  | { kind: "provider_unavailable" };

export type VerifyPaymentOutcome =
  | { kind: "status"; orderId: string; status: PaymentStatusResponse }
  | { kind: "not_found" }
  | { kind: "provider_unavailable" };

export type MarkOrderPaidOutcome =
  | "paid"
  | "not_found"
  | "already_paid"
  | "amount_mismatch"
  | "expired"
  | "not_pending";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Money only ever moves through Prisma.Decimal. A hostile payload that is not
// a finite number or a parseable numeric string becomes null and never reaches
// a comparison, so it can only block a payment, never approve one.
function toDecimal(value: unknown): Prisma.Decimal | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? new Prisma.Decimal(value) : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return new Prisma.Decimal(value);
    } catch {
      return null;
    }
  }
  return null;
}

function toPesewas(total: Prisma.Decimal): string {
  return new Prisma.Decimal(total).times(100).toFixed(0);
}

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function toPaystackDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapPaymentStatus(status: PaymentStatus): PaymentStatusResponse {
  switch (status) {
    case PaymentStatus.PAID:
      return "paid";
    case PaymentStatus.FAILED:
      return "failed";
    case PaymentStatus.PENDING:
      return "pending";
    default:
      throw new Error(`Unknown payment status: ${String(status)}`);
  }
}

export async function initializePayment(
  orderId: string,
): Promise<InitializePaymentOutcome> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      reference: true,
      customerEmail: true,
      total: true,
      paymentStatus: true,
      reservedUntil: true,
    },
  });

  if (!order) return { kind: "not_found" };
  if (order.paymentStatus !== PaymentStatus.PENDING) {
    return { kind: "not_found" };
  }
  if (
    order.reservedUntil !== null &&
    order.reservedUntil.getTime() < Date.now()
  ) {
    return { kind: "not_found" };
  }

  const reference = `${order.reference}-${Date.now()}`;
  const amount = toPesewas(order.total);

  await prisma.order.update({
    where: { id: order.id },
    data: { paystackRef: reference },
  });

  let payload: unknown;
  try {
    const response = await fetch(
      `${PAYSTACK_API_BASE}/transaction/initialize`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: order.customerEmail,
          amount,
          currency: PAYSTACK_CURRENCY,
          reference,
          callback_url: `${env.FRONTEND_URL}/confirmation/${order.id}`,
        }),
      },
    );

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      console.error(
        `Paystack initialize returned HTTP ${response.status}:`,
        payload,
      );
      return { kind: "provider_unavailable" };
    }
  } catch (error) {
    console.error("Paystack initialize request failed:", error);
    return { kind: "provider_unavailable" };
  }

  if (!isRecord(payload) || payload.status !== true || !isRecord(payload.data)) {
    console.error("Paystack initialize returned an unexpected payload");
    return { kind: "provider_unavailable" };
  }

  const authorizationUrl = payload.data.authorization_url;
  if (typeof authorizationUrl !== "string" || authorizationUrl.length === 0) {
    console.error("Paystack initialize response has no authorization_url");
    return { kind: "provider_unavailable" };
  }

  return { kind: "ok", authorizationUrl, reference };
}

export async function verifyPayment(
  reference: string,
): Promise<VerifyPaymentOutcome> {
  let httpStatus = 0;
  let payload: unknown = null;

  try {
    const response = await fetch(
      `${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } },
    );
    httpStatus = response.status;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } catch (error) {
    console.error("Paystack verify request failed:", error);
    return { kind: "provider_unavailable" };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    // Only the status and message are logged: a verify payload carries the
    // customer object, which must never reach the log.
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : "no message";
    console.warn(`Paystack verify returned HTTP ${httpStatus}: ${message}`);
  } else if (
    isRecord(payload) &&
    isRecord(payload.data) &&
    payload.data.status === "success"
  ) {
    const paidAt = toPaystackDate(payload.data.paid_at) ?? new Date();
    const currency =
      typeof payload.data.currency === "string" ? payload.data.currency : "";

    await markOrderPaid(reference, payload.data.amount, currency, paidAt);
  }

  const order = await prisma.order.findUnique({
    where: { paystackRef: reference },
    select: { id: true, paymentStatus: true },
  });

  if (!order) return { kind: "not_found" };

  return {
    kind: "status",
    orderId: order.id,
    status: mapPaymentStatus(order.paymentStatus),
  };
}

/**
 * The single path that marks an order PAID, shared by the webhook and the
 * verify endpoint. Stock, inventory logs, and fulfillment are never touched
 * here: the stock was reserved when the order was created.
 */
export async function markOrderPaid(
  reference: string,
  amountPesewas: unknown,
  currency: string,
  paidAt: Date,
): Promise<MarkOrderPaidOutcome> {
  const order = await prisma.order.findUnique({
    where: { paystackRef: reference },
    select: { id: true, total: true, paymentStatus: true },
  });

  if (!order) {
    console.warn(`PAYMENT_UNKNOWN_REFERENCE reference=${reference}`);
    return "not_found";
  }

  if (order.paymentStatus === PaymentStatus.PAID) {
    return "already_paid";
  }

  const expectedPesewas = new Prisma.Decimal(order.total).times(100);
  const receivedPesewas = toDecimal(amountPesewas);

  if (
    receivedPesewas === null ||
    currency !== PAYSTACK_CURRENCY ||
    !receivedPesewas.equals(expectedPesewas)
  ) {
    console.error(
      `PAYMENT_AMOUNT_MISMATCH orderId=${order.id} expected=${expectedPesewas.toFixed(0)} received=${receivedPesewas === null ? "invalid" : receivedPesewas.toFixed(0)} currency=${currency}`,
    );
    return "amount_mismatch";
  }

  if (order.paymentStatus === PaymentStatus.FAILED) {
    console.error(
      `PAYMENT_ON_EXPIRED_ORDER orderId=${order.id} reference=${reference}`,
    );
    return "expired";
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: order.id, paymentStatus: PaymentStatus.PENDING },
      data: {
        paymentStatus: PaymentStatus.PAID,
        paidAt,
        reservedUntil: null,
      },
    });

    // The conditional update is the concurrency guard: whichever caller does
    // not flip PENDING -> PAID writes nothing and returns.
    if (updated.count !== 1) return "not_pending";

    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      select: { productId: true, quantity: true, unitPrice: true },
    });

    for (const item of items) {
      await tx.dailySale.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          saleDate: utcDayStart(paidAt),
          quantity: item.quantity,
          amount: item.unitPrice.times(item.quantity),
        },
      });
    }

    return "paid";
  });
}
