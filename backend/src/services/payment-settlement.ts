import { randomBytes } from "crypto";

import {
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
} from "../generated/prisma/client";

import type { PaymentStatusResponse } from "../types/payments";

export const PAYSTACK_CURRENCY = "GHS";

// 12 bytes = 24 hex chars appended to the order reference. Far beyond collision
// range and well under Paystack's 100-character reference limit.
const ATTEMPT_REFERENCE_BYTES = 12;

export const MAX_ATTEMPT_ALLOCATION_ATTEMPTS = 3;

// Bounded retries for transient database transaction conflicts (deadlock /
// serialization failure). Every attempt is atomic, so re-running is safe.
export const SETTLE_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 25;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Money only ever moves through Prisma.Decimal. A hostile value that is not a
// finite number or a parseable numeric string becomes null and never reaches a
// comparison, so it can only block a payment, never approve one.
export function toDecimal(value: unknown): Prisma.Decimal | null {
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

export function toPesewas(total: Prisma.Decimal): string {
  return new Prisma.Decimal(total).times(100).toFixed(0);
}

// Integer pesewas are stored as BigInt because DECIMAL(10,2) can represent
// 99,999,999.99 GHS = 9,999,999,999 pesewas, which exceeds Int32.
export function toPesewaBigInt(value: Prisma.Decimal | null): bigint | null {
  if (value === null || !value.isInteger()) return null;
  return BigInt(value.toFixed(0));
}

export function generateAttemptReference(orderReference: string): string {
  return `${orderReference}-${randomBytes(ATTEMPT_REFERENCE_BYTES).toString("hex")}`;
}

export function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function toPaystackDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function mapPaymentStatus(status: PaymentStatus): PaymentStatusResponse {
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

export function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  const target = error.meta?.target;
  if (typeof target === "string") return target.includes(field);
  if (Array.isArray(target)) return target.some((value) => value === field);
  return false;
}

// A late provider success may still arrive after an attempt was marked FAILED
// or ABANDONED, so those states remain re-openable. SUCCEEDED and MISMATCH are
// terminal.
export function canRecordSuccess(status: PaymentAttemptStatus): boolean {
  return (
    status === PaymentAttemptStatus.INITIALIZED ||
    status === PaymentAttemptStatus.FAILED ||
    status === PaymentAttemptStatus.ABANDONED
  );
}

export type ProviderMatchResult =
  | { ok: true; amountPesewas: bigint }
  | { ok: false; kind: "AMOUNT_MISMATCH" | "CURRENCY_MISMATCH" };

export function matchProviderAgainstAttempt(
  attempt: { amountPesewas: bigint; currency: string },
  providerAmount: unknown,
  providerCurrency: string,
): ProviderMatchResult {
  if (providerCurrency !== attempt.currency) {
    return { ok: false, kind: "CURRENCY_MISMATCH" };
  }

  const received = toDecimal(providerAmount);
  if (received === null) {
    return { ok: false, kind: "AMOUNT_MISMATCH" };
  }

  const expected = new Prisma.Decimal(attempt.amountPesewas.toString());
  if (!received.equals(expected)) {
    return { ok: false, kind: "AMOUNT_MISMATCH" };
  }

  return { ok: true, amountPesewas: attempt.amountPesewas };
}

export type OrderSettlementPlan =
  | "settle"
  | "duplicate_charge"
  | "after_expiry";

export function planOrderSettlement(
  paymentStatus: PaymentStatus,
): OrderSettlementPlan {
  switch (paymentStatus) {
    case PaymentStatus.PENDING:
      return "settle";
    case PaymentStatus.PAID:
      return "duplicate_charge";
    case PaymentStatus.FAILED:
      return "after_expiry";
    default:
      return "after_expiry";
  }
}

export function isTransactionRetryable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTransactionRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = SETTLE_MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransactionRetryable(error) || attempt >= maxAttempts) {
        throw error;
      }
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
}
