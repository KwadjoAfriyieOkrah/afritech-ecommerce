import { Router } from "express";

import { listProducts } from "../controllers/products.controller";

const router = Router();

router.get("/", listProducts);

export default router;