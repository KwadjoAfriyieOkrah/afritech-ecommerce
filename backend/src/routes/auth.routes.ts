import { Router } from "express";

import {
  getCurrentUserProfile,
  loginUser,
  logoutUser,
  registerUser,
} from "../controllers/auth.controller";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.get("/me", requireAuth, getCurrentUserProfile);

export default router;
