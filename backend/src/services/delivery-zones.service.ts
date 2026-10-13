import { prisma } from "../lib/prisma";
import type { DeliveryZoneResponse } from "../types/deliveryZones";

export async function listActiveDeliveryZones(): Promise<
  DeliveryZoneResponse[]
> {
  const zones = await prisma.deliveryZone.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { name: true, fee: true, expectedDays: true },
  });

  return zones.map((zone) => ({
    name: zone.name,
    fee: Number(zone.fee),
    expectedDays: zone.expectedDays,
  }));
}
