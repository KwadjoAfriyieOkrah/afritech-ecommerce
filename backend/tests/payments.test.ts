import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PaymentAttemptStatus, PaymentStatus, Prisma } from "@prisma/client";

import {
  PAYSTACK_CURRENCY,
  canRecordSuccess,
  generateAttemptReference,
  isRecord,
  isTransactionRetryable,
  isUniqueViolation,
  mapPaymentStatus,
  matchProviderAgainstAttempt,
  planOrderSettlement,
  toDecimal,
  toPesewaBigInt,
  toPesewas,
  utcDayStart,
  withTransactionRetry,
} from "../src/services/payment-settlement";

const BACKEND_ROOT = path.join(__dirname, "..");

function readRepoFile(...parts: string[]): string {
  return readFileSync(path.join(BACKEND_ROOT, ...parts), "utf8");
}

function knownError(code: string, target?: unknown): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("test", {
    code,
    clientVersion: "test",
    meta: target === undefined ? undefined : { target },
  });
}

// ---------------------------------------------------------------------------
// Reference generation: uniqueness and Paystack length limits.
// ---------------------------------------------------------------------------
test("generateAttemptReference is unique, prefixed and within Paystack's limit", () => {
  const orderReference = "AFR-" + "X".repeat(20);
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i += 1) {
    const reference = generateAttemptReference(orderReference);
    assert.ok(reference.startsWith(`${orderReference}-`));
    assert.ok(reference.length <= 100, "reference must fit Paystack's 100-char cap");
    assert.ok(!seen.has(reference), "references must not collide");
    seen.add(reference);
  }
  assert.equal(seen.size, 5000);
});

// ---------------------------------------------------------------------------
// Money parsing: hostile input can only block a payment, never approve one.
// ---------------------------------------------------------------------------
test("toDecimal accepts finite numbers and numeric strings, rejects everything else", () => {
  assert.ok(toDecimal(100)?.equals(100));
  assert.ok(toDecimal("100")?.equals(100));
  assert.ok(toDecimal("100.50")?.equals(new Prisma.Decimal("100.50")));
  assert.equal(toDecimal(Number.NaN), null);
  assert.equal(toDecimal(Number.POSITIVE_INFINITY), null);
  assert.equal(toDecimal(""), null);
  assert.equal(toDecimal("   "), null);
  assert.equal(toDecimal("abc"), null);
  assert.equal(toDecimal(null), null);
  assert.equal(toDecimal(undefined), null);
  assert.equal(toDecimal({ amount: 100 }), null);
});

test("toPesewas scales to integer minor units using exact decimal math", () => {
  assert.equal(toPesewas(new Prisma.Decimal("0.01")), "1");
  assert.equal(toPesewas(new Prisma.Decimal("10.10")), "1010");
  assert.equal(toPesewas(new Prisma.Decimal("100.00")), "10000");
});

test("pesewas exceed Int32 range, so BigInt is required", () => {
  const maxTotal = new Prisma.Decimal("99999999.99");
  const pesewas = BigInt(toPesewas(maxTotal));
  assert.equal(pesewas, BigInt("9999999999"));
  assert.ok(pesewas > BigInt(2_147_483_647), "must not fit Int32");
});

test("toPesewaBigInt only converts whole numbers and never overflows", () => {
  assert.equal(toPesewaBigInt(new Prisma.Decimal("1010")), BigInt(1010));
  assert.equal(toPesewaBigInt(new Prisma.Decimal("10.10")), null);
  assert.equal(toPesewaBigInt(null), null);
  assert.equal(
    toPesewaBigInt(new Prisma.Decimal("9999999999")),
    BigInt("9999999999"),
  );
});

// ---------------------------------------------------------------------------
// Provider evidence matching.
// ---------------------------------------------------------------------------
test("matchProviderAgainstAttempt requires exact amount and currency", () => {
  const attempt = { amountPesewas: BigInt(1000), currency: PAYSTACK_CURRENCY };

  const ok = matchProviderAgainstAttempt(attempt, 1000, PAYSTACK_CURRENCY);
  assert.deepEqual(ok, { ok: true, amountPesewas: BigInt(1000) });

  const currency = matchProviderAgainstAttempt(attempt, 1000, "NGN");
  assert.deepEqual(currency, { ok: false, kind: "CURRENCY_MISMATCH" });

  const amount = matchProviderAgainstAttempt(attempt, 999, PAYSTACK_CURRENCY);
  assert.deepEqual(amount, { ok: false, kind: "AMOUNT_MISMATCH" });

  const hostile = matchProviderAgainstAttempt(attempt, "abc", PAYSTACK_CURRENCY);
  assert.deepEqual(hostile, { ok: false, kind: "AMOUNT_MISMATCH" });

  const missing = matchProviderAgainstAttempt(attempt, null, PAYSTACK_CURRENCY);
  assert.deepEqual(missing, { ok: false, kind: "AMOUNT_MISMATCH" });
});

test("string amounts equal numeric attempts (provider may send either)", () => {
  const attempt = { amountPesewas: BigInt(1500), currency: PAYSTACK_CURRENCY };
  const result = matchProviderAgainstAttempt(attempt, "1500", PAYSTACK_CURRENCY);
  assert.deepEqual(result, { ok: true, amountPesewas: BigInt(1500) });
});

// ---------------------------------------------------------------------------
// Attempt-state re-open rules: a late success after FAILED/ABANDONED counts,
// but a terminal attempt is never re-processed.
// ---------------------------------------------------------------------------
test("canRecordSuccess re-opens initial, failed and abandoned attempts only", () => {
  assert.equal(canRecordSuccess(PaymentAttemptStatus.INITIALIZED), true);
  assert.equal(canRecordSuccess(PaymentAttemptStatus.FAILED), true);
  assert.equal(canRecordSuccess(PaymentAttemptStatus.ABANDONED), true);
  assert.equal(canRecordSuccess(PaymentAttemptStatus.SUCCEEDED), false);
  assert.equal(canRecordSuccess(PaymentAttemptStatus.MISMATCH), false);
});

test("planOrderSettlement distinguishes settle, duplicate charge and after-expiry", () => {
  assert.equal(planOrderSettlement(PaymentStatus.PENDING), "settle");
  assert.equal(planOrderSettlement(PaymentStatus.PAID), "duplicate_charge");
  assert.equal(planOrderSettlement(PaymentStatus.FAILED), "after_expiry");
});

test("mapPaymentStatus covers the persisted order statuses", () => {
  assert.equal(mapPaymentStatus(PaymentStatus.PENDING), "pending");
  assert.equal(mapPaymentStatus(PaymentStatus.PAID), "paid");
  assert.equal(mapPaymentStatus(PaymentStatus.FAILED), "failed");
});

// ---------------------------------------------------------------------------
// Duplicate/conflict detection helpers.
// ---------------------------------------------------------------------------
test("isUniqueViolation only matches P2002 on the requested field", () => {
  assert.equal(isUniqueViolation(knownError("P2002", ["reference"]), "reference"), true);
  assert.equal(isUniqueViolation(knownError("P2002", "reference"), "reference"), true);
  assert.equal(isUniqueViolation(knownError("P2002", ["other"]), "reference"), false);
  assert.equal(isUniqueViolation(knownError("P2025"), "reference"), false);
  assert.equal(isUniqueViolation(new Error("boom"), "reference"), false);
});

test("isTransactionRetryable only matches Prisma P2034", () => {
  assert.equal(isTransactionRetryable(knownError("P2034")), true);
  assert.equal(isTransactionRetryable(knownError("P2002")), false);
  assert.equal(isTransactionRetryable(new Error("boom")), false);
});

test("withTransactionRetry retries transient conflicts then succeeds", async () => {
  let calls = 0;
  const result = await withTransactionRetry(async () => {
    calls += 1;
    if (calls < 3) throw knownError("P2034");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withTransactionRetry gives up after the bounded attempt count", async () => {
  let calls = 0;
  await assert.rejects(
    withTransactionRetry(async () => {
      calls += 1;
      throw knownError("P2034");
    }, 3),
    (error: unknown) => isTransactionRetryable(error),
  );
  assert.equal(calls, 3);
});

test("withTransactionRetry does not retry non-transactional errors", async () => {
  let calls = 0;
  await assert.rejects(
    withTransactionRetry(async () => {
      calls += 1;
      throw new Error("permanent");
    }),
    /permanent/,
  );
  assert.equal(calls, 1);
});

test("utcDayStart truncates to the UTC day boundary", () => {
  const start = utcDayStart(new Date("2026-10-17T23:59:59.999Z"));
  assert.equal(start.toISOString(), "2026-10-17T00:00:00.000Z");
});

test("isRecord narrows plain objects only", () => {
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord([]), true);
  assert.equal(isRecord("x"), false);
  assert.equal(isRecord(42), false);
});

// ---------------------------------------------------------------------------
// Migration A static guarantees (cannot run against a DB here).
// ---------------------------------------------------------------------------
test("migration creates attempts and reconciliation without ON CONFLICT DO NOTHING", () => {
  const sql = readRepoFile(
    "prisma",
    "migrations",
    "20261018180000_payment_attempts_and_reconciliation",
    "migration.sql",
  );

  assert.ok(sql.includes('CREATE TABLE "PaymentAttempt"'));
  assert.ok(sql.includes('CREATE TABLE "ReconciliationEntry"'));
  assert.ok(sql.includes('CREATE UNIQUE INDEX "PaymentAttempt_reference_key"'));
  assert.ok(
    sql.includes(
      'CREATE UNIQUE INDEX "ReconciliationEntry_reference_reason_key"',
    ),
  );

  assert.ok(sql.includes("NOT EXISTS"), "backfill must be idempotent");
  assert.ok(sql.includes("RAISE EXCEPTION"), "backfill must fail loudly");
  const sqlNoComments = sql.replace(/--[^\n]*/g, "");
  assert.ok(
    !/ON\s+CONFLICT\s+DO\s+NOTHING/i.test(sqlNoComments),
    "must not silently swallow conflicts",
  );

  // Backfill fabricates no provider evidence: the insert column list must not
  // mention any provider- or confirmation-derived column.
  const backfill = sql.slice(sql.indexOf('INSERT INTO "PaymentAttempt"'));
  const insertColumns = backfill.slice(
    backfill.indexOf("(") + 1,
    backfill.indexOf(")"),
  );
  for (const forbidden of [
    "providerAmountPesewas",
    "providerCurrency",
    "providerTransactionId",
    "confirmedAt",
  ]) {
    assert.ok(
      !insertColumns.includes(forbidden),
      `backfill must not fabricate ${forbidden}`,
    );
  }
  assert.ok(sql.includes('o."paystackRef" IS NOT NULL'));
  assert.ok(sql.includes("INITIALIZED"));
});

test("migration makes reconciliation orderId optional with SET NULL", () => {
  const sql = readRepoFile(
    "prisma",
    "migrations",
    "20261018180000_payment_attempts_and_reconciliation",
    "migration.sql",
  );
  assert.ok(/"orderId" TEXT,/);
  assert.ok(
    sql.includes(
      'FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL',
    ),
  );
});

// ---------------------------------------------------------------------------
// Source invariants: single writers, no unsafe casts, server-only secrets.
// ---------------------------------------------------------------------------
test("PaymentAttempt is the payment lookup key, not Order.paystackRef", () => {
  const service = readRepoFile("src", "services", "payments.service.ts");
  assert.ok(service.includes("paymentAttempt.findUnique"));
  assert.ok(service.includes("paymentAttempt.create"));
  assert.ok(
    !/where:\s*\{\s*paystackRef/.test(service),
    "no payment lookup may key on the mutable Order.paystackRef",
  );
});

test("only payments.service marks an order PAID and writes the sales ledger", () => {
  const service = readRepoFile("src", "services", "payments.service.ts");
  assert.ok(service.includes("paymentStatus: PaymentStatus.PAID"));
  assert.ok(service.includes("tx.dailySale.create"));

  const reservations = readRepoFile("src", "services", "reservations.service.ts");
  assert.ok(
    !reservations.includes("PaymentStatus.PAID"),
    "the sweeper must never mark an order paid",
  );
});

test("settlement never trusts a client-supplied amount and logs no secrets", () => {
  const service = readRepoFile("src", "services", "payments.service.ts");
  assert.ok(service.includes("matchProviderAgainstAttempt"));
  assert.ok(
    !/PAYSTACK_SECRET_KEY/.test(
      readRepoFile("src", "services", "payment-settlement.ts"),
    ),
    "shared pure module must not read secrets",
  );
});

// ---------------------------------------------------------------------------
// Reservation-sweeper concurrency: shared bounded retry, per-order isolation,
// and a lock order that matches settlement. Real deadlock behavior needs a
// database and cannot be exercised here.
// ---------------------------------------------------------------------------
test("reservation sweep retries transient conflicts through the shared policy", () => {
  const reservations = readRepoFile("src", "services", "reservations.service.ts");
  assert.ok(
    /withTransactionRetry\(\s*\(\)\s*=>\s*prisma\.\$transaction/.test(reservations),
    "each release must run inside the bounded retrying transaction wrapper",
  );
});

test("one reservation's failure cannot abort the rest of the sweep", () => {
  const reservations = readRepoFile("src", "services", "reservations.service.ts");
  const loop = reservations.slice(
    reservations.indexOf("for (const order of expired)"),
  );
  assert.ok(loop.length > 0, "the sweep must iterate over expired orders");
  assert.ok(loop.includes("try {"), "each order's release must be guarded");
  assert.ok(loop.includes("catch"), "a failing order must be caught, not propagated");
  assert.ok(
    loop.indexOf("try {") < loop.indexOf("prisma.$transaction"),
    "the guarded section must contain the transaction",
  );
  assert.ok(
    loop.indexOf("prisma.$transaction") < loop.indexOf("catch"),
    "the failure of the transaction must be caught inside the loop",
  );
});

test("the sweeper takes the PaymentAttempt lock before the Order lock", () => {
  const reservations = readRepoFile("src", "services", "reservations.service.ts");
  const attemptLock = reservations.indexOf("paymentAttempt.updateMany");
  const orderLock = reservations.indexOf("order.updateMany");
  assert.ok(attemptLock !== -1, "the sweeper must abandon open attempts");
  assert.ok(orderLock !== -1, "the sweeper must flip the order status");
  assert.ok(
    attemptLock < orderLock,
    "PaymentAttempt must be locked before Order to match settleAttempt",
  );
});

test("stock is restored only by the caller that wins the PENDING->FAILED race", () => {
  const reservations = readRepoFile("src", "services", "reservations.service.ts");
  const guard = reservations.indexOf("if (updated.count !== 1) return false;");
  const stockRestore = reservations.indexOf("stock: { increment: item.quantity }");
  const ledger = reservations.indexOf("tx.inventoryLog.create");
  assert.ok(guard !== -1, "losing the race must be a no-op");
  assert.ok(stockRestore !== -1, "winning the race must restore stock");
  assert.ok(ledger !== -1, "winning the race must write an inventory log");
  assert.ok(guard < stockRestore, "stock restore must be gated on the conditional win");
  assert.ok(guard < ledger, "the inventory ledger write must be gated too");
});
