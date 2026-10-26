import {
  InventoryReason,
  PaymentAttemptStatus,
  PaymentStatus,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import { withTransactionRetry } from "./payment-settlement";

const MAX_RESERVATIONS_PER_SWEEP = 50;

/**
 * Releases stock held by unpaid reservations whose window has elapsed.
 *
 * Concurrency: every order is released in its own transaction so a single
 * failure cannot roll back the rest. Within a transaction the locked rows are
 * acquired in the same order as settleAttempt (PaymentAttempt -> Order -> stock)
 * so a reservation expiry and a late payment success can never deadlock.
 * Transient conflicts (Prisma P2034: deadlock / serialization failure) are
 * retried a bounded number of times by the shared policy.
 *
 * Idempotency: the conditional updateMany guarantees only the call that
 * actually flips PENDING -> FAILED restores stock and writes the ledger rows.
 */
export async function releaseExpiredReservations(now: Date): Promise<number> {
  const expired = await prisma.order.findMany({
    where: {
      paymentStatus: PaymentStatus.PENDING,
      reservedUntil: { lt: now },
    },
    orderBy: { reservedUntil: "asc" },
    take: MAX_RESERVATIONS_PER_SWEEP,
    select: {
      id: true,
      items: { select: { colorId: true, quantity: true } },
    },
  });

  let released = 0;

  for (const order of expired) {
    try {
      const didRelease = await withTransactionRetry(() =>
        prisma.$transaction(async (tx) => {
          // Take the PaymentAttempt lock before the Order lock to match
          // settleAttempt's order and avoid a deadlock. A late success on an
          // ABANDONED attempt is still recordable and becomes a durable
          // reconciliation entry, so abandoning an attempt is safe even if this
          // order loses the race below and is not actually released.
          await tx.paymentAttempt.updateMany({
            where: {
              orderId: order.id,
              status: PaymentAttemptStatus.INITIALIZED,
            },
            data: { status: PaymentAttemptStatus.ABANDONED },
          });

          // Conditional transition: only the caller that actually flips
          // PENDING -> FAILED restores stock. Losing the race is a no-op.
          const updated = await tx.order.updateMany({
            where: { id: order.id, paymentStatus: PaymentStatus.PENDING },
            data: {
              paymentStatus: PaymentStatus.FAILED,
              reservedUntil: null,
            },
          });

          if (updated.count !== 1) return false;

          for (const item of order.items) {
            await tx.color.update({
              where: { id: item.colorId },
              data: { stock: { increment: item.quantity } },
            });

            await tx.inventoryLog.create({
              data: {
                colorId: item.colorId,
                change: item.quantity,
                reason: InventoryReason.ADJUSTMENT,
                orderId: order.id,
                note: "reservation expired",
              },
            });
          }

          return true;
        }),
      );

      if (didRelease) released += 1;
    } catch (error) {
      // One order's failure (e.g. a deadlock that outlived the bounded retries)
      // must not abort the remaining reservations in this sweep; it is retried
      // on the next tick.
      // eslint-disable-next-line no-console
      console.error(
        `Reservation release failed for order ${order.id}; continuing sweep:`,
        error,
      );
    }
  }

  return released;
}
