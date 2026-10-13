import { Router } from "express";

import { listDeliveryZones } from "../controllers/delivery-zones.controller";

const router = Router();

router.get("/", listDeliveryZones);

export default router;
