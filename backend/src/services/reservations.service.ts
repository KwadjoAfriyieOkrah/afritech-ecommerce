import { InventoryReason, PaymentStatus } from "@prisma/client";

import { prisma } from "../lib/prisma";

const MAX_RESERVATIONS_PER_SWEEP = 50;

/**
 * Releases stock held by unpaid reservations whose window has elapsed.
 * Each order is released in its own transaction so one failure cannot roll
 * back the rest. The conditional updateMany makes the operation idempotent:
 * only the call that actually flips PENDING -> FAILED restores stock.
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
    const didRelease = await prisma.$transaction(async (tx) => {
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
    });

    if (didRelease) released += 1;
  }

  return released;
}
