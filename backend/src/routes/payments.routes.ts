import { Router } from "express";

import {
  initializePaymentHandler,
  verifyPaymentHandler,
} from "../controllers/payments.controller";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.post("/initialize", requireAuth, initializePaymentHandler);
router.get("/verify/:reference", requireAuth, verifyPaymentHandler);

export default router;
