import { Router } from "express";

import {
  initializePaymentHandler,
  verifyPaymentHandler,
} from "../controllers/payments.controller";
import { optionalAuth } from "../middleware/optionalAuth";

const router = Router();

// A guest pays with the order access token, so these routes accept either a
// signed-in customer or a guest token.
router.post("/initialize", optionalAuth, initializePaymentHandler);
router.get("/verify/:reference", optionalAuth, verifyPaymentHandler);

export default router;
