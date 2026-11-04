import type { NextFunction, Request, Response } from "express";

import { getCurrentUser, verifyToken } from "../services/auth.service";
import { UNAUTHORIZED_MESSAGE } from "./requireAuth";
import { clearAuthCookie } from "../lib/authCookie";
import { readRequestAuthToken } from "./requestAuthToken";

/**
 * Attaches req.authUser when a valid Bearer token is supplied, but does not
 * require one. A present-but-invalid token is still rejected with 401 so
 * callers cannot silently fall back to guest checkout.
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { token, provided } = readRequestAuthToken(req);
  if (!provided) {
    next();
    return;
  }

  if (!token) {
    clearAuthCookie(res);
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    clearAuthCookie(res);
    res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
    return;
  }

  try {
    const user = await getCurrentUser(payload.sub);
    if (!user) {
      clearAuthCookie(res);
      res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
      return;
    }

    req.authUser = user;
    next();
  } catch (error) {
    console.error("Unexpected optional auth error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
}
