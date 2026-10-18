import { Router } from "express";
import { Role } from "@prisma/client";

import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

const router = Router();

router.use(requireAuth);
router.use(requireRole(Role.ADMIN));

router.get("/fulfillment/queue", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

export default router;
