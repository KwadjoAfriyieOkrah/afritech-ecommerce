import {
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
  ReconciliationReason,
} from "@prisma/client";

import { env } from "../lib/env";
import {
  hashGuestAccessToken,
  matchesAccessTokenHash,
} from "../lib/guestAccessToken";
import { prisma } from "../lib/prisma";
import type { PaymentStatusResponse } from "../types/payments";
import {
  MAX_ATTEMPT_ALLOCATION_ATTEMPTS,
  PAYSTACK_CURRENCY,
  canRecordSuccess,
  generateAttemptReference,
  isRecord,
  isUniqueViolation,
  mapPaymentStatus,
  matchProviderAgainstAttempt,
  planOrderSettlement,
  toDecimal,
  toPaystackDate,
  toPesewaBigInt,
  toPesewas,
  utcDayStart,
  withTransactionRetry,
} from "./payment-settlement";

const PAYSTACK_API_BASE = "https://api.paystack.co";
const SYSTEM_EMAIL_DOMAIN = "noreply.afritech.local";

/**
 * The caller of a payment endpoint. A signed-in customer is identified by
 * their user id, a guest by the access token they received when the order was
 * created.
 */
export interface OrderAccess {
  userId: string | null;
  accessToken: string | null;
}

export type InitializePaymentOutcome =
  | {
      kind: "ok";
      reference: string;
      amount: number;
      /**
       * The address the provider request is built with. It is never stored on
       * the order and never sent to the client.
       */
      providerEmail: string;
      /**
       * The address the customer gave us. Null for a guest who did not leave
       * one, in which case the system address is used for the provider.
       */
      customerEmail: string | null;
      currency: string;
    }
  | { kind: "not_found" }
  | { kind: "already_paid" }
  | { kind: "expired" };

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

/**
 * Every terminal result of attempting to settle a verified provider success.
 * These are exhaustive so callers (webhook, verify) can map them to HTTP
 * without guessing.
 */
export type SettleOutcome =
  | "paid"
  | "duplicate_notification"
  | "mismatch_notification"
  | "duplicate_charge"
  | "after_expiry"
  | "mismatch"
  | "unknown_reference"
  | "order_missing";

export interface SettleAttemptInput {
  reference: string;
  providerAmount: unknown;
  providerCurrency: string;
  paidAt: Date;
  providerTransactionId: string | null;
  source: "webhook" | "verify";
}

interface ReconciliationInput {
  reference: string;
  reason: ReconciliationReason;
  orderId?: string | null;
  attemptId?: string | null;
  amountPesewas?: bigint | null;
  providerCurrency?: string | null;
  providerTransactionId?: string | null;
  note?: string | null;
}

function reconciliationNote(reason: ReconciliationReason): string {
  switch (reason) {
    case ReconciliationReason.DUPLICATE_CHARGE:
      return "a separate successful charge arrived after the order was already paid";
    case ReconciliationReason.PAYMENT_AFTER_EXPIRY:
      return "payment succeeded after the reservation expired or the order failed";
    case ReconciliationReason.AMOUNT_MISMATCH:
      return "provider amount did not match the stored attempt";
    case ReconciliationReason.CURRENCY_MISMATCH:
      return "provider currency did not match the stored attempt";
    case ReconciliationReason.ORDER_MISSING:
      return "order row was missing during settlement";
    case ReconciliationReason.UNKNOWN_REFERENCE:
      return "successful provider event for a reference with no stored attempt";
    default:
      return "unexpected settlement outcome";
  }
}

// Persists a durable, actionable reconciliation row. createMany + skipDuplicates
// makes repeated notifications for the same (reference, reason) a no-op, so a
// captured payment is recorded exactly once and never silently discarded.
async function recordReconciliation(
  tx: Prisma.TransactionClient,
  input: ReconciliationInput,
): Promise<void> {
  await tx.reconciliationEntry.createMany({
    data: [
      {
        reference: input.reference,
        reason: input.reason,
        orderId: input.orderId ?? null,
        attemptId: input.attemptId ?? null,
        amountPesewas: input.amountPesewas ?? null,
        providerCurrency: input.providerCurrency ?? null,
        providerTransactionId: input.providerTransactionId ?? null,
        note: input.note ?? reconciliationNote(input.reason),
      },
    ],
    skipDuplicates: true,
  });
}

// Thrown inside initializePayment's transaction to roll back a claim on an
// order that stopped being payable between the pre-read and the transaction.
class OrderUnavailableError extends Error {
  readonly kind: "not_found" | "expired";

  constructor(kind: "not_found" | "expired") {
    super(kind);
    this.name = "OrderUnavailableError";
    this.kind = kind;
    Object.setPrototypeOf(this, OrderUnavailableError.prototype);
  }
}

/**
 * The candidates a caller may reach: their own orders, and the orders whose
 * access token hash matches the one they presented. The hash is derived in
 * code, so the query narrows the rows the database has to consider while the
 * authoritative comparison stays in code.
 */
function buildOwnershipFilters(
  access: OrderAccess,
): Prisma.OrderWhereInput[] {
  const filters: Prisma.OrderWhereInput[] = [];
  if (access.userId !== null) filters.push({ userId: access.userId });
  if (access.accessToken !== null) {
    filters.push({ accessTokenHash: hashGuestAccessToken(access.accessToken) });
  }
  return filters;
}

/**
 * The authoritative ownership check. The order owner is matched by id, a
 * guest by a constant-time comparison of the presented token with the stored
 * hash. A false result is never distinguished from an unknown order.
 */
function isAuthorizedForOrder(
  order: { userId: string | null; accessTokenHash: string | null },
  access: OrderAccess,
): boolean {
  if (
    access.userId !== null &&
    order.userId !== null &&
    order.userId === access.userId
  ) {
    return true;
  }
  if (access.accessToken === null) return false;
  return matchesAccessTokenHash(access.accessToken, order.accessTokenHash);
}

// The address a provider request is built with when the customer left no
// email. It is a placeholder for the provider only: it is never stored on the
// order and never sent to the client.
function systemOrderEmail(reference: string): string {
  return `order-${reference.toLowerCase()}@${SYSTEM_EMAIL_DOMAIN}`;
}

/**
 * Authorizes a new payment attempt for an order the caller owns and mints a
 * fresh, backend-generated Paystack reference for it. Each call inserts its own
 * immutable PaymentAttempt row, so concurrent calls cannot invalidate each
 * other's reference. Amount, currency and email come from the stored order,
 * never from the request. No provider call happens here. The attempt insert and
 * the order's legacy paystackRef update commit together, and the paystackRef
 * update only succeeds while the order is still PENDING.
 */
export async function initializePayment(
  orderId: string,
  userId: string | null,
  accessToken: string | null = null,
): Promise<InitializePaymentOutcome> {
  const access: OrderAccess = { userId, accessToken };
  const ownershipFilters = buildOwnershipFilters(access);

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      ...(ownershipFilters.length > 0 ? { OR: ownershipFilters } : {}),
    },
    select: {
      id: true,
      reference: true,
      customerEmail: true,
      total: true,
      paymentStatus: true,
      reservedUntil: true,
      userId: true,
      accessTokenHash: true,
    },
  });

  // Unknown, another user's, and unreachable orders are indistinguishable.
  if (!order) return { kind: "not_found" };
  // The token is compared against the stored hash in constant time, so a
  // guessing attacker learns nothing from how long the answer took.
  if (!isAuthorizedForOrder(order, access)) return { kind: "not_found" };
  if (order.paymentStatus === PaymentStatus.PAID) {
    return { kind: "already_paid" };
  }
  if (order.paymentStatus !== PaymentStatus.PENDING) {
    return { kind: "expired" };
  }
  // A reservation that has elapsed has already released (or is about to
  // release) its stock, so it must not become payable again.
  if (
    order.reservedUntil !== null &&
    order.reservedUntil.getTime() < Date.now()
  ) {
    return { kind: "expired" };
  }

  const amountPesewas = BigInt(toPesewas(order.total));

  for (
    let attempt = 0;
    attempt < MAX_ATTEMPT_ALLOCATION_ATTEMPTS;
    attempt += 1
  ) {
    const reference = generateAttemptReference(order.reference);

    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.order.updateMany({
          where: { id: order.id, paymentStatus: PaymentStatus.PENDING },
          data: { paystackRef: reference },
        });

        if (claimed.count === 0) {
          const current = await tx.order.findUnique({
            where: { id: order.id },
            select: { paymentStatus: true },
          });
          throw new OrderUnavailableError(current ? "expired" : "not_found");
        }

        await tx.paymentAttempt.create({
          data: {
            orderId: order.id,
            reference,
            amountPesewas,
            currency: PAYSTACK_CURRENCY,
          },
        });
      });

      return {
        kind: "ok",
        reference,
        amount: Number(amountPesewas),
        providerEmail:
          order.customerEmail ?? systemOrderEmail(order.reference),
        customerEmail: order.customerEmail,
        currency: PAYSTACK_CURRENCY,
      };
    } catch (error) {
      // The conditional paystackRef claim missed: the order vanished or left
      // PENDING (settled, failed, or expired) after the pre-read above. The
      // whole transaction, including the attempt row, has rolled back.
      if (error instanceof OrderUnavailableError) {
        return { kind: error.kind };
      }
      // A collision on the unique attempt reference is astronomically unlikely;
      // retry with a new reference rather than failing the customer.
      if (isUniqueViolation(error, "reference")) continue;
      throw error;
    }
  }

  throw new Error("Could not allocate a unique payment reference");
}

async function fetchProviderVerification(
  reference: string,
): Promise<
  | { kind: "unavailable" }
  | { kind: "not_success" }
  | {
      kind: "success";
      amount: unknown;
      currency: string;
      paidAt: Date;
      providerTransactionId: string | null;
    }
> {
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
    return { kind: "unavailable" };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    // Only the status and message are logged: a verify payload carries the
    // customer object, which must never reach the log.
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : "no message";
    console.warn(`Paystack verify returned HTTP ${httpStatus}: ${message}`);
    return { kind: "not_success" };
  }

  if (
    isRecord(payload) &&
    isRecord(payload.data) &&
    payload.data.status === "success"
  ) {
    const paidAt = toPaystackDate(payload.data.paid_at) ?? new Date();
    const currency =
      typeof payload.data.currency === "string" ? payload.data.currency : "";
    const providerTransactionId = readTransactionId(payload.data.id);

    return {
      kind: "success",
      amount: payload.data.amount,
      currency,
      paidAt,
      providerTransactionId,
    };
  }

  return { kind: "not_success" };
}

function readTransactionId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
}

export async function verifyPayment(
  reference: string,
  userId: string | null,
  accessToken: string | null = null,
): Promise<VerifyPaymentOutcome> {
  const access: OrderAccess = { userId, accessToken };
  const ownershipFilters = buildOwnershipFilters(access);

  // Ownership is part of the query: a reference owned by another user is
  // indistinguishable from one that does not exist. The attempt row persists,
  // so a superseded/abandoned reference still resolves.
  const attempt = await prisma.paymentAttempt.findFirst({
    where: {
      reference,
      order: ownershipFilters.length > 0 ? { OR: ownershipFilters } : {},
    },
    select: {
      id: true,
      orderId: true,
      status: true,
      order: {
        select: {
          paymentStatus: true,
          userId: true,
          accessTokenHash: true,
        },
      },
    },
  });
  if (!attempt) return { kind: "not_found" };
  // The token is compared against the stored hash in constant time.
  if (!isAuthorizedForOrder(attempt.order, access)) {
    return { kind: "not_found" };
  }

  // Only ask Paystack when a provider result could still change: a terminal
  // attempt (SUCCEEDED/MISMATCH) or an already-paid order is returned as-is.
  if (
    canRecordSuccess(attempt.status) &&
    attempt.order.paymentStatus !== PaymentStatus.PAID
  ) {
    const verification = await fetchProviderVerification(reference);

    if (verification.kind === "unavailable") {
      return { kind: "provider_unavailable" };
    }

    if (verification.kind === "success") {
      await settleAttempt({
        reference,
        providerAmount: verification.amount,
        providerCurrency: verification.currency,
        paidAt: verification.paidAt,
        providerTransactionId: verification.providerTransactionId,
        source: "verify",
      });
    }
  }

  const current = await prisma.order.findUnique({
    where: { id: attempt.orderId },
    select: { paymentStatus: true },
  });
  if (!current) return { kind: "not_found" };

  return {
    kind: "status",
    orderId: attempt.orderId,
    status: mapPaymentStatus(current.paymentStatus),
  };
}

/**
 * The single entry point for a trusted provider success (signed webhook or a
 * successful verify call). Runs entirely in one transaction so the attempt
 * state, the order's PENDING -> PAID transition, the sales ledger row and any
 * reconciliation record either all commit or all roll back.
 */
export async function settleAttempt(
  input: SettleAttemptInput,
): Promise<SettleOutcome> {
  return withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      const attempt = await tx.paymentAttempt.findUnique({
        where: { reference: input.reference },
        select: {
          id: true,
          orderId: true,
          reference: true,
          status: true,
          currency: true,
          amountPesewas: true,
          providerTransactionId: true,
        },
      });

      const providerAmountPesewas = toPesewaBigInt(
        toDecimal(input.providerAmount),
      );
      const providerCurrency = input.providerCurrency || null;

      if (!attempt) {
        await recordReconciliation(tx, {
          reference: input.reference,
          reason: ReconciliationReason.UNKNOWN_REFERENCE,
          amountPesewas: providerAmountPesewas,
          providerCurrency,
          providerTransactionId: input.providerTransactionId,
        });
        console.warn(
          `PAYMENT_UNKNOWN_REFERENCE source=${input.source} recorded for reconciliation`,
        );
        return "unknown_reference";
      }

      // A terminal attempt is never re-classified: a repeated or malformed
      // notification for an already-settled charge must not create a spurious
      // mismatch record against a paid order.
      if (!canRecordSuccess(attempt.status)) {
        return attempt.status === PaymentAttemptStatus.MISMATCH
          ? "mismatch_notification"
          : "duplicate_notification";
      }

      const match = matchProviderAgainstAttempt(
        attempt,
        input.providerAmount,
        input.providerCurrency,
      );

      if (!match.ok) {
        // Record provider evidence once; never overwrite it on later notices.
        await tx.paymentAttempt.updateMany({
          where: { id: attempt.id, providerAmountPesewas: null },
          data: {
            providerAmountPesewas,
            providerCurrency,
            providerTransactionId: input.providerTransactionId,
          },
        });
        await tx.paymentAttempt.updateMany({
          where: {
            id: attempt.id,
            status: {
              in: [
                PaymentAttemptStatus.INITIALIZED,
                PaymentAttemptStatus.FAILED,
                PaymentAttemptStatus.ABANDONED,
              ],
            },
          },
          data: {
            status: PaymentAttemptStatus.MISMATCH,
            reconciliationReason: match.kind,
          },
        });
        await recordReconciliation(tx, {
          reference: attempt.reference,
          reason: match.kind,
          orderId: attempt.orderId,
          attemptId: attempt.id,
          amountPesewas: providerAmountPesewas,
          providerCurrency,
          providerTransactionId: input.providerTransactionId,
        });
        console.warn(
          `PAYMENT_AMOUNT_MISMATCH attemptId=${attempt.id} kind=${match.kind}`,
        );
        return "mismatch";
      }

      // Conditional transition: only one settlement can flip the attempt, so a
      // repeated notification for the same charge writes nothing.
      const updated = await tx.paymentAttempt.updateMany({
        where: {
          id: attempt.id,
          status: {
            in: [
              PaymentAttemptStatus.INITIALIZED,
              PaymentAttemptStatus.FAILED,
              PaymentAttemptStatus.ABANDONED,
            ],
          },
        },
        data: {
          status: PaymentAttemptStatus.SUCCEEDED,
          confirmedAt: input.paidAt,
          providerAmountPesewas: match.amountPesewas,
          providerCurrency: input.providerCurrency,
          providerTransactionId:
            input.providerTransactionId ?? attempt.providerTransactionId,
        },
      });

      if (updated.count !== 1) {
        return attempt.status === PaymentAttemptStatus.MISMATCH
          ? "mismatch_notification"
          : "duplicate_notification";
      }

      const order = await tx.order.findUnique({
        where: { id: attempt.orderId },
        select: { id: true, total: true, paymentStatus: true },
      });

      if (!order) {
        await recordReconciliation(tx, {
          reference: attempt.reference,
          reason: ReconciliationReason.ORDER_MISSING,
          orderId: attempt.orderId,
          attemptId: attempt.id,
          amountPesewas: match.amountPesewas,
          providerCurrency,
          providerTransactionId: input.providerTransactionId,
        });
        console.warn(`PAYMENT_ORDER_MISSING attemptId=${attempt.id}`);
        return "order_missing";
      }

      const plan = planOrderSettlement(order.paymentStatus);

      if (plan === "duplicate_charge") {
        await recordReconciliation(tx, {
          reference: attempt.reference,
          reason: ReconciliationReason.DUPLICATE_CHARGE,
          orderId: order.id,
          attemptId: attempt.id,
          amountPesewas: match.amountPesewas,
          providerCurrency,
          providerTransactionId: input.providerTransactionId,
        });
        console.warn(
          `PAYMENT_DUPLICATE_CHARGE orderId=${order.id} attemptId=${attempt.id}`,
        );
        return "duplicate_charge";
      }

      if (plan === "after_expiry") {
        await recordReconciliation(tx, {
          reference: attempt.reference,
          reason: ReconciliationReason.PAYMENT_AFTER_EXPIRY,
          orderId: order.id,
          attemptId: attempt.id,
          amountPesewas: match.amountPesewas,
          providerCurrency,
          providerTransactionId: input.providerTransactionId,
        });
        console.warn(
          `PAYMENT_AFTER_EXPIRY orderId=${order.id} attemptId=${attempt.id}`,
        );
        return "after_expiry";
      }

      const outcome = await markOrderPaid(
        tx,
        order.id,
        new Prisma.Decimal(match.amountPesewas.toString()),
        input.providerCurrency,
        input.paidAt,
      );

      switch (outcome) {
        case "paid":
          return "paid";
        case "already_paid":
          await recordReconciliation(tx, {
            reference: attempt.reference,
            reason: ReconciliationReason.DUPLICATE_CHARGE,
            orderId: order.id,
            attemptId: attempt.id,
            amountPesewas: match.amountPesewas,
            providerCurrency,
            providerTransactionId: input.providerTransactionId,
          });
          console.warn(
            `PAYMENT_DUPLICATE_CHARGE orderId=${order.id} attemptId=${attempt.id}`,
          );
          return "duplicate_charge";
        case "not_pending": {
          const after = await tx.order.findUnique({
            where: { id: order.id },
            select: { paymentStatus: true },
          });
          const reason =
            after?.paymentStatus === PaymentStatus.PAID
              ? ReconciliationReason.DUPLICATE_CHARGE
              : ReconciliationReason.PAYMENT_AFTER_EXPIRY;
          await recordReconciliation(tx, {
            reference: attempt.reference,
            reason,
            orderId: order.id,
            attemptId: attempt.id,
            amountPesewas: match.amountPesewas,
            providerCurrency,
            providerTransactionId: input.providerTransactionId,
          });
          console.warn(
            `PAYMENT_${reason} orderId=${order.id} attemptId=${attempt.id}`,
          );
          return reason === ReconciliationReason.DUPLICATE_CHARGE
            ? "duplicate_charge"
            : "after_expiry";
        }
        case "expired":
          await recordReconciliation(tx, {
            reference: attempt.reference,
            reason: ReconciliationReason.PAYMENT_AFTER_EXPIRY,
            orderId: order.id,
            attemptId: attempt.id,
            amountPesewas: match.amountPesewas,
            providerCurrency,
            providerTransactionId: input.providerTransactionId,
          });
          console.warn(
            `PAYMENT_AFTER_EXPIRY orderId=${order.id} attemptId=${attempt.id}`,
          );
          return "after_expiry";
        case "amount_mismatch":
          await recordReconciliation(tx, {
            reference: attempt.reference,
            reason: ReconciliationReason.AMOUNT_MISMATCH,
            orderId: order.id,
            attemptId: attempt.id,
            amountPesewas: match.amountPesewas,
            providerCurrency,
            providerTransactionId: input.providerTransactionId,
          });
          return "mismatch";
        case "not_found":
          return "order_missing";
        default:
          return "mismatch";
      }
    }),
  );
}

/**
 * The single path that marks an order PAID and the single creator of its
 * DailySale rows. Always called inside the settleAttempt transaction (no nested
 * transaction). Stock, inventory logs and fulfillment are never touched here:
 * stock was reserved when the order was created.
 */
async function markOrderPaid(
  tx: Prisma.TransactionClient,
  orderId: string,
  providerPesewas: Prisma.Decimal,
  currency: string,
  paidAt: Date,
): Promise<MarkOrderPaidOutcome> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { total: true, paymentStatus: true },
  });

  if (!order) return "not_found";
  if (order.paymentStatus === PaymentStatus.PAID) return "already_paid";

  const orderPesewas = new Prisma.Decimal(order.total).times(100);
  if (currency !== PAYSTACK_CURRENCY || !providerPesewas.equals(orderPesewas)) {
    return "amount_mismatch";
  }

  if (order.paymentStatus === PaymentStatus.FAILED) return "expired";

  const updated = await tx.order.updateMany({
    where: { id: orderId, paymentStatus: PaymentStatus.PENDING },
    data: {
      paymentStatus: PaymentStatus.PAID,
      reservedUntil: null,
    },
  });

  // The conditional update is the concurrency guard: whichever caller does not
  // flip PENDING -> PAID writes nothing.
  if (updated.count !== 1) return "not_pending";

  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true, quantity: true, unitPrice: true },
  });

  for (const item of items) {
    await tx.dailySale.create({
      data: {
        orderId,
        productId: item.productId,
        saleDate: utcDayStart(paidAt),
        quantity: item.quantity,
        amount: item.unitPrice.times(item.quantity),
      },
    });
  }

  return "paid";
}
