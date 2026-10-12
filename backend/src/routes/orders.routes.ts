import { Router } from "express";

import { listOrders } from "../controllers/orders.controller";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.get("/", requireAuth, listOrders);

export default router;
