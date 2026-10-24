import { Router } from "express";

import {
  getOrder,
  listOrders,
  submitOrder,
  trackOrderHandler,
} from "../controllers/orders.controller";
import { optionalAuth } from "../middleware/optionalAuth";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

// Tracking is public, so it has to be registered before the "/:id" route,
// otherwise "track" would be read as an order id.
router.get("/track", trackOrderHandler);

router.get("/", requireAuth, listOrders);
// Guests may check out without an account.
router.post("/", optionalAuth, submitOrder);
router.get("/:id", requireAuth, getOrder);

export default router;
