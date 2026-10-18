import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { UNAUTHORIZED_MESSAGE } from "./requireAuth";

// One body for every rejection: a caller must not be able to tell a real user
// who merely lacks the role from one that does not exist.
export const FORBIDDEN_MESSAGE = "Forbidden";

export function requireRole(...roles: Role[]) {
  return async function authorizeRole(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: UNAUTHORIZED_MESSAGE });
      return;
    }

    try {
      // The role is read from the database on every request, so a role change
      // (or a deleted account) takes effect immediately rather than at the
      // token's expiry.
      const record = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });

      if (!record || !roles.includes(record.role)) {
        res.status(403).json({ error: FORBIDDEN_MESSAGE });
        return;
      }

      next();
    } catch (error) {
      console.error("Unexpected role check error:", error);
      res.status(500).json({ error: "Something went wrong" });
    }
  };
}
