import type { Request, Response } from "express";

import { listActiveProducts } from "../services/products.service";

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