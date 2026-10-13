import { Router } from "express";

import { listOrders, submitOrder } from "../controllers/orders.controller";
import { optionalAuth } from "../middleware/optionalAuth";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.get("/", requireAuth, listOrders);
router.post("/", optionalAuth, submitOrder);

export default router;
