import { Router } from "express";

import {
  checkAvailability,
  listProducts,
} from "../controllers/products.controller";

const router = Router();

// Declared before any parameterised route so "availability" is never captured
// as an id.
router.post("/availability", checkAvailability);

router.get("/", listProducts);

export default router;