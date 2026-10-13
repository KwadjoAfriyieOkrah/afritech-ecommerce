import type { Request, Response } from "express";

import { listActiveDeliveryZones } from "../services/delivery-zones.service";

export async function listDeliveryZones(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const zones = await listActiveDeliveryZones();
    res.status(200).json(zones);
  } catch (error) {
    console.error("Failed to list delivery zones:", error);
    res.status(500).json({ error: "Could not load delivery zones" });
  }
}
