import type { Request, Response } from "express";

import { UNAUTHORIZED_MESSAGE } from "../middleware/requireAuth";
import { listOrdersForUser } from "../services/orders.service";

export async function listOrders(req: Request, res: Response): Promise<void> {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  try {
    const orders = await listOrdersForUser(user.id);
    res.status(200).json(orders);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to list orders:", error);
    res.status(500).json({ error: "Could not load orders" });
  }
}
