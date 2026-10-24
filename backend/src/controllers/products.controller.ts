import type { Request, Response } from "express";

import {
  checkProductAvailability,
  listActiveProducts,
} from "../services/products.service";
import {
  productAvailabilitySchema,
  toProductValidationDetails,
} from "../validation/products.schemas";

export async function listProducts(_req: Request, res: Response): Promise<void> {
  try {
    const products = await listActiveProducts();
    res.status(200).json(products);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to list products:", error);
    res.status(500).json({ error: "Could not load products" });
  }
}

export async function checkAvailability(req: Request, res: Response): Promise<void> {
  const parsed = productAvailabilitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: toProductValidationDetails(parsed.error),
    });
    return;
  }

  try {
    const availability = await checkProductAvailability(parsed.data.items);
    res.status(200).json(availability);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to check availability:", error);
    res.status(500).json({ error: "Could not check availability" });
  }
}