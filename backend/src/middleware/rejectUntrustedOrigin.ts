import type { NextFunction, Request, Response } from "express";

import { env } from "../lib/env";

const FRONTEND_ORIGIN = new URL(env.FRONTEND_URL).origin;

export function rejectUntrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }

  try {
    if (new URL(origin).origin === FRONTEND_ORIGIN) {
      next();
      return;
    }
  } catch {
    res.status(403).json({ error: "Request origin is not allowed" });
    return;
  }

  res.status(403).json({ error: "Request origin is not allowed" });
}
