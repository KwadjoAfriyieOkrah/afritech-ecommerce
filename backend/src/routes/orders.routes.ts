import { Router } from "express";

import {
  getOrder,
  listOrders,
  submitOrder,
} from "../controllers/orders.controller";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.get("/", requireAuth, listOrders);
router.post("/", requireAuth, submitOrder);
router.get("/:id", requireAuth, getOrder);

export default router;
