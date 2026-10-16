import { Router } from "express";

import {
  initializePaymentHandler,
  verifyPaymentHandler,
} from "../controllers/payments.controller";

const router = Router();

router.post("/initialize", initializePaymentHandler);
router.get("/verify/:reference", verifyPaymentHandler);

export default router;
