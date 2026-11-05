import type { NextFunction, Request, Response } from "express";

import {
  getCurrentUser,
  verifyToken,
  type PublicUser,
} from "../services/auth.service";
import { clearAuthCookie } from "../lib/authCookie";
import { readRequestAuthToken } from "./requestAuthToken";

export const UNAUTHORIZED_MESSAGE = "Unauthorized";

declare global {
  namespace Express {
    interface Request {
      authUser?: PublicUser;
    }
  }
}

function reject(res: Response): void {
  clearAuthCookie(res);
  res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { token } = readRequestAuthToken(req);
  if (!token) {
    reject(res);
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    reject(res);
    return;
  }

  try {
    const user = await getCurrentUser(payload.sub, payload.credentialVersion);
    if (!user) {
      reject(res);
      return;
    }

    req.authUser = user;
    next();
  } catch (error) {
    console.error("Unexpected auth middleware error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
}
