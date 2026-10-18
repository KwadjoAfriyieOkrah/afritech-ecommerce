-- Additive migration: PaymentAttempt + ReconciliationEntry.
--
-- WARNING: The foreign keys below take SHARE ROW EXCLUSIVE locks on "Order".
-- Stop the backend before running this migration.
-- Nothing existing is dropped or rewritten, and Order."paystackRef" is left in place.
--
-- Backfill policy:
--   * One PaymentAttempt per existing Order with a non-null paystackRef.
--   * Provider evidence (providerAmountPesewas, providerCurrency,
--     providerTransactionId, confirmedAt) is deliberately left NULL: we only
--     know the server-side total, never the provider's confirmed values.
--   * The backfill is deterministic (id = order id) and idempotent, so it may
--     be re-run without creating duplicates.
--   * A verification block after the insert fails the migration loudly if any
--     eligible order was skipped or if a reference resolves to the wrong order.
--     This replaces a silent "ON CONFLICT DO NOTHING".
BEGIN;

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIALIZED', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('NONE', 'PENDING', 'REFUNDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReconciliationReason" AS ENUM ('UNKNOWN_REFERENCE', 'ORDER_MISSING', 'DUPLICATE_CHARGE', 'PAYMENT_AFTER_EXPIRY', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'UNEXPECTED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountPesewas" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIALIZED',
    "refundStatus" "RefundStatus" NOT NULL DEFAULT 'NONE',
    "reconciliationReason" "ReconciliationReason",
    "providerAmountPesewas" BIGINT,
    "providerCurrency" TEXT,
    "providerTransactionId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "reconciliationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationEntry" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "attemptId" TEXT,
    "reference" TEXT NOT NULL,
    "reason" "ReconciliationReason" NOT NULL,
    "amountPesewas" BIGINT,
    "providerCurrency" TEXT,
    "providerTransactionId" TEXT,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_reference_key" ON "PaymentAttempt"("reference");

-- CreateIndex
CREATE INDEX "PaymentAttempt_orderId_idx" ON "PaymentAttempt"("orderId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_status_idx" ON "PaymentAttempt"("status");

-- CreateIndex
CREATE INDEX "PaymentAttempt_refundStatus_idx" ON "PaymentAttempt"("refundStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationEntry_attemptId_key" ON "ReconciliationEntry"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationEntry_reference_reason_key" ON "ReconciliationEntry"("reference", "reason");

-- CreateIndex
CREATE INDEX "ReconciliationEntry_status_idx" ON "ReconciliationEntry"("status");

-- CreateIndex
CREATE INDEX "ReconciliationEntry_createdAt_idx" ON "ReconciliationEntry"("createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationEntry_orderId_idx" ON "ReconciliationEntry"("orderId");

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEntry" ADD CONSTRAINT "ReconciliationEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEntry" ADD CONSTRAINT "ReconciliationEntry_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: derive one attempt per existing order reference without inventing
-- provider evidence.
INSERT INTO "PaymentAttempt" (
    "id",
    "orderId",
    "reference",
    "amountPesewas",
    "currency",
    "status",
    "refundStatus",
    "createdAt",
    "updatedAt"
)
SELECT
    o."id",
    o."id",
    o."paystackRef",
    ROUND(o."total" * 100)::bigint,
    'GHS',
    CASE o."paymentStatus"
        WHEN 'PAID' THEN 'SUCCEEDED'::"PaymentAttemptStatus"
        WHEN 'FAILED' THEN 'FAILED'::"PaymentAttemptStatus"
        ELSE 'INITIALIZED'::"PaymentAttemptStatus"
    END,
    'NONE'::"RefundStatus",
    o."createdAt",
    o."updatedAt"
FROM "Order" o
WHERE o."paystackRef" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "PaymentAttempt" pa WHERE pa."reference" = o."paystackRef"
  );

-- Verification: fail visibly instead of silently dropping records.
DO $$
DECLARE
    missing_count integer;
    conflict_count integer;
BEGIN
    SELECT COUNT(*) INTO missing_count
    FROM "Order" o
    WHERE o."paystackRef" IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM "PaymentAttempt" pa WHERE pa."reference" = o."paystackRef"
      );

    IF missing_count <> 0 THEN
        RAISE EXCEPTION 'PaymentAttempt backfill incomplete: % order(s) with a paystackRef have no attempt', missing_count;
    END IF;

    SELECT COUNT(*) INTO conflict_count
    FROM "Order" o
    JOIN "PaymentAttempt" pa ON pa."reference" = o."paystackRef"
    WHERE pa."orderId" <> o."id";

    IF conflict_count <> 0 THEN
        RAISE EXCEPTION 'PaymentAttempt backfill conflict: % attempt(s) reference a different order', conflict_count;
    END IF;
END $$;
COMMIT;
