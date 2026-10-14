import { Router } from "express";

import {
  getOrder,
  listOrders,
  submitOrder,
} from "../controllers/orders.controller";
import { optionalAuth } from "../middleware/optionalAuth";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.get("/", requireAuth, listOrders);
router.post("/", optionalAuth, submitOrder);
router.get("/:id", requireAuth, getOrder);

export default router;
